// E-commerce test data seeder: reads a scenario template (JSON) and seeds SQLite
// (products -> orders -> payments, in dependency order) using Node's built-in node:sqlite.
// Requires Node >= 22.5. No npm dependencies.
//
// Usage:
//   node seeder.mjs -t scenarios/ecommerce.template.json --db seeded.db
//   node seeder.mjs -t scenarios/bulk.template.json --db seeded.db --dry-run
//   node seeder.mjs -t scenarios/ecommerce.template.json --db seeded.db --clean
//
// Options:
//   -t, --template <file>  scenario template (default scenarios/ecommerce.template.json)
//       --db <file>        target SQLite file (default seeded_ecommerce.db)
//       --only <id>        seed only these scenario ids (repeatable)
//       --clean            first delete rows created earlier by the template's scenarios (re-runnable)
//       --reset            drop all tables first (full re-seed)
//       --dry-run          validate and print the plan, write nothing
//       --out <file>       key map output (scenario -> order/payment ids), default seed-result.json
//   -h, --help

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    template: { type: 'string', short: 't', default: 'scenarios/ecommerce.template.json' },
    db: { type: 'string', default: 'seeded_ecommerce.db' },
    only: { type: 'string', multiple: true },
    clean: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string', default: 'seed-result.json' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const ORDER_STATUS = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
const PAY_STATUS = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND'];
const PAY_METHOD = ['CARD', 'PROMPTPAY', 'BANK_TRANSFER', 'COD'];
const PAID_STATUS = ['SUCCESS', 'REFUNDED', 'PARTIAL_REFUND']; // statuses that carry paid_at
const round2 = n => Math.round(n * 100) / 100;

// ---------- Date helpers (local wall-clock arithmetic with a fixed offset) ----------
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad datetime "${s}" (expected YYYY-MM-DDTHH:MM:SS)`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
const fmtLocal = (ms, tz) => new Date(ms).toISOString().slice(0, 19) + tz;

// ---------- Load + validate template ----------
let tpl;
try {
  tpl = JSON.parse(readFileSync(opt.template, 'utf8'));
} catch (e) {
  console.error(`Cannot read template ${opt.template}: ${e.message}`);
  process.exit(2);
}

const errors = [];
const err = msg => errors.push(msg);

const tz = tpl.timezone ?? '+07:00';
if (!/^[+-]\d{2}:\d{2}$/.test(tz)) err(`timezone "${tz}" must look like +07:00`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(tpl.businessDate ?? '')) err('businessDate must be YYYY-MM-DD');

const templateProducts = tpl.products ?? [];
for (const p of templateProducts) {
  for (const k of ['sku', 'name', 'category', 'price', 'stock_qty', 'is_active']) {
    if (p[k] === undefined) err(`product ${p.sku ?? '?'}: missing "${k}"`);
  }
}

const scenarioIds = new Set();
for (const s of tpl.scenarios ?? []) {
  if (!/^[a-z0-9_]+$/.test(s.id ?? '')) err(`scenario id "${s.id}" must match [a-z0-9_]+`);
  if (scenarioIds.has(s.id)) err(`duplicate scenario id "${s.id}"`);
  scenarioIds.add(s.id);
  if (!s.order) err(`scenario ${s.id}: missing "order"`);
}
for (const id of opt.only ?? []) {
  if (!scenarioIds.has(id)) err(`--only "${id}" is not a scenario in the template`);
}
if (errors.length) fail(errors);

function fail(list) {
  console.error('Template errors:\n' + list.map(e => `  - ${e}`).join('\n'));
  process.exit(2);
}

// ---------- Open DB + schema ----------
const dryRun = opt['dry-run'];
const db = new DatabaseSync(dryRun ? ':memory:' : opt.db);
db.exec('PRAGMA foreign_keys = ON;');
if (opt.reset && !dryRun) {
  db.exec('DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS products;');
}
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  product_id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0), stock_qty INTEGER NOT NULL CHECK (stock_qty >= 0),
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)));
CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY, customer_id TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price REAL NOT NULL, total_amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PAID','SHIPPED','DELIVERED','CANCELLED','REFUNDED')),
  order_date TEXT NOT NULL, scenario TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  payment_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(order_id),
  method TEXT NOT NULL CHECK (method IN ('CARD','PROMPTPAY','BANK_TRANSFER','COD')), amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAILED','REFUNDED','PARTIAL_REFUND')),
  paid_at TEXT, refund_amount REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_product  ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_order  ON payments(order_id);
`);

// ---------- Build the plan (pure computation, nothing written yet) ----------
// Product catalogue = DB products overlaid with template products (template wins).
const catalogue = new Map();
for (const r of db.prepare('SELECT sku, price FROM products').all()) catalogue.set(r.sku, Number(r.price));
for (const p of templateProducts) catalogue.set(p.sku, p.price);

const activeScenarios = (tpl.scenarios ?? []).filter(s => !opt.only?.length || opt.only.includes(s.id));
const plan = [];
let seq = 0;

for (const s of activeScenarios) {
  const repeat = s.repeat ?? 1;
  for (let n = 1; n <= repeat; n++) {
    seq++;
    const where = `scenario ${s.id}${repeat > 1 ? `#${n}` : ''}`;
    const o = s.order;

    if (!catalogue.has(o.sku)) { err(`${where}: unknown sku "${o.sku}"`); continue; }
    if (!ORDER_STATUS.includes(o.status)) err(`${where}: bad order status "${o.status}"`);
    if (!Number.isInteger(o.quantity) || o.quantity <= 0) err(`${where}: quantity must be a positive integer`);

    // order timestamp: explicit "date", else businessDate + dayOffset + time (default 09:00 + 1 min per order)
    let orderMs;
    try {
      orderMs = o.date
        ? parseLocal(o.date)
        : parseLocal(`${tpl.businessDate}T${o.time ?? '09:00:00'}`) + (o.dayOffset ?? 0) * 86400000 + (o.time ? 0 : (seq - 1) * 60000);
    } catch (e) { err(`${where}: ${e.message}`); continue; }

    const priceOverridden = o.unitPrice !== undefined;
    const unitPrice = priceOverridden ? o.unitPrice : catalogue.get(o.sku);
    const total = round2(o.quantity * unitPrice);
    const customer = (s.customer ?? `AUTO-${s.id}-{n}`).replaceAll('{n}', String(n));

    const payments = [];
    (s.payments ?? []).forEach((p, i) => {
      const pw = `${where} payment[${i}]`;
      if (!PAY_METHOD.includes(p.method)) err(`${pw}: bad method "${p.method}"`);
      if (!PAY_STATUS.includes(p.status)) err(`${pw}: bad status "${p.status}"`);
      const amount = round2(p.amount ?? total);

      let refund = 0;
      if (p.status === 'REFUNDED') refund = p.refund === undefined || p.refund === 'full' ? amount : p.refund;
      else if (p.status === 'PARTIAL_REFUND') {
        if (typeof p.refund !== 'number') err(`${pw}: PARTIAL_REFUND needs a numeric "refund"`);
        else if (p.refund <= 0 || p.refund >= amount) err(`${pw}: partial refund must be > 0 and < amount`);
        refund = p.refund ?? 0;
      } else if (p.refund) err(`${pw}: refund only allowed for REFUNDED/PARTIAL_REFUND`);

      const paidAt = PAID_STATUS.includes(p.status) ? fmtLocal(orderMs + (p.paidAfterSec ?? 70) * 1000, tz) : null;
      payments.push({ method: p.method, amount, status: p.status, paid_at: paidAt, refund_amount: round2(refund) });
    });

    plan.push({
      scenarioId: s.id, instance: n,
      scenarioText: `${s.id}: ${s.description ?? ''}`.trim(),
      customer, sku: o.sku, quantity: o.quantity, unitPrice, priceOverridden, total,
      status: o.status, orderDate: fmtLocal(orderMs, tz), payments,
    });
  }
}
if (errors.length) fail(errors);

// ---------- Assign ids ----------
const nextId = (table, col, start) => {
  const max = db.prepare(`SELECT COALESCE(MAX(${col}), 0) AS m FROM ${table}`).get().m;
  return Math.max(start, Number(max) + 1);
};

// ---------- Dry run ----------
if (dryRun) {
  console.log(`DRY RUN  template=${opt.template}  scenarios=${activeScenarios.length}  orders=${plan.length}  payments=${plan.reduce((a, p) => a + p.payments.length, 0)}`);
  console.table(plan.map(p => ({
    scenario: p.scenarioId + (p.instance > 1 ? `#${p.instance}` : ''), customer: p.customer, sku: p.sku,
    qty: p.quantity, total: p.total, order: p.status, payments: p.payments.map(x => `${x.method}:${x.status}`).join(' + ') || '-',
  })));
  process.exit(0);
}

// ---------- Seed (single transaction) ----------
const result = { template: opt.template, db: opt.db, businessDate: tpl.businessDate, scenarios: {} };
const seededOrderIds = [];
const priceOverriddenIds = new Set();

db.exec('BEGIN');
try {
  if (opt.clean) {
    // Remove rows created earlier by this template's scenarios (matched by the "<id>:" prefix in orders.scenario).
    const del = [...scenarioIds];
    for (const id of del) {
      db.prepare(`DELETE FROM payments WHERE order_id IN (SELECT order_id FROM orders WHERE substr(scenario,1,?) = ?)`).run(id.length + 1, `${id}:`);
      db.prepare(`DELETE FROM orders WHERE substr(scenario,1,?) = ?`).run(id.length + 1, `${id}:`);
    }
  }

  // 1) products (upsert by sku)
  const upsertProduct = db.prepare(`
    INSERT INTO products (product_id, sku, name, category, price, stock_qty, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category=excluded.category,
      price=excluded.price, stock_qty=excluded.stock_qty, is_active=excluded.is_active`);
  let nextProductId = nextId('products', 'product_id', 1);
  for (const p of templateProducts) {
    upsertProduct.run(p.id ?? nextProductId++, p.sku, p.name, p.category, p.price, p.stock_qty, p.is_active);
  }
  const productId = new Map(db.prepare('SELECT sku, product_id FROM products').all().map(r => [r.sku, Number(r.product_id)]));

  // 2) orders, 3) payments
  const insOrder = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)');
  const insPay = db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?)');
  let orderId = nextId('orders', 'order_id', tpl.startOrderId ?? 1);
  let paymentId = nextId('payments', 'payment_id', tpl.startPaymentId ?? 1);

  for (const p of plan) {
    const oid = orderId++;
    insOrder.run(oid, p.customer, productId.get(p.sku), p.quantity, p.unitPrice, p.total, p.status, p.orderDate, p.scenarioText);
    seededOrderIds.push(oid);
    if (p.priceOverridden) priceOverriddenIds.add(oid);

    const pids = [];
    for (const x of p.payments) {
      const pid = paymentId++;
      insPay.run(pid, oid, x.method, x.amount, x.status, x.paid_at, x.refund_amount);
      pids.push(pid);
    }
    (result.scenarios[p.scenarioId] ??= []).push({ customer: p.customer, order_id: oid, payment_ids: pids });
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error(`Seeding failed, rolled back: ${e.message}`);
  process.exit(1);
}

writeFileSync(opt.out, JSON.stringify(result, null, 2));

// ---------- Reconciliation checks (scoped to the orders seeded in this run) ----------
const ids = seededOrderIds.join(',') || 'NULL';
const skipPrice = [...priceOverriddenIds].join(',') || 'NULL';
const checks = [
  ['orders.total_amount = quantity * unit_price',
   `SELECT COUNT(*) c FROM orders WHERE order_id IN (${ids}) AND total_amount <> quantity * unit_price`],
  ['orders.unit_price matches products.price (except explicit unitPrice overrides)',
   `SELECT COUNT(*) c FROM orders o JOIN products p USING(product_id) WHERE o.order_id IN (${ids}) AND o.order_id NOT IN (${skipPrice}) AND o.unit_price <> p.price`],
  ['payments.amount = orders.total_amount (single-payment amounts as templated)',
   `SELECT COUNT(*) c FROM payments p JOIN orders o USING(order_id) WHERE o.order_id IN (${ids}) AND p.amount <> o.total_amount`],
  ['refund_amount consistent with payment status',
   `SELECT COUNT(*) c FROM payments WHERE order_id IN (${ids}) AND (
      (status IN ('REFUNDED','PARTIAL_REFUND') AND refund_amount <= 0)
      OR (status NOT IN ('REFUNDED','PARTIAL_REFUND') AND refund_amount <> 0))`],
  ['paid_at consistent with payment status',
   `SELECT COUNT(*) c FROM payments WHERE order_id IN (${ids}) AND (
      (status IN ('SUCCESS','REFUNDED','PARTIAL_REFUND') AND paid_at IS NULL)
      OR (status IN ('PENDING','FAILED') AND paid_at IS NOT NULL))`],
  ['PAID/SHIPPED/DELIVERED orders have a successful (or COD) payment',
   `SELECT COUNT(*) c FROM orders o WHERE o.order_id IN (${ids}) AND o.status IN ('PAID','SHIPPED','DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.order_id
                      AND (p.status IN ('SUCCESS','PARTIAL_REFUND') OR p.method = 'COD'))`],
  ['no FK violations', 'SELECT COUNT(*) c FROM pragma_foreign_key_check'],
];

let failed = 0;
for (const [name, sql] of checks) {
  const n = db.prepare(sql).get().c;
  if (n) failed++;
  console.log(`${n === 0 ? 'PASS' : 'FAIL'}  ${name}${n ? `  (violations: ${n})` : ''}`);
}

const count = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log(`\nSeeded ${plan.length} orders from ${activeScenarios.length} scenarios -> ${opt.db}`);
console.log(`Table totals: products=${count('products')} orders=${count('orders')} payments=${count('payments')}`);
console.log(`Key map: ${opt.out}`);
db.close();
process.exit(failed ? 1 : 0);
