// Build the e-commerce Golden Dataset into a SQLite file using Node's built-in node:sqlite.
// Usage: node build-golden-db.mjs [output.db]
// Requires Node >= 22.5 (node:sqlite). Data is fully deterministic: same file every run.

import { DatabaseSync } from 'node:sqlite';
import { rmSync, existsSync } from 'node:fs';

const OUT = process.argv[2] ?? 'golden_ecommerce.db';
if (existsSync(OUT)) rmSync(OUT);

const db = new DatabaseSync(OUT);
db.exec('PRAGMA foreign_keys = ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE products (
  product_id  INTEGER PRIMARY KEY,
  sku         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  price       REAL    NOT NULL CHECK (price >= 0),          -- THB
  stock_qty   INTEGER NOT NULL CHECK (stock_qty >= 0),
  is_active   INTEGER NOT NULL CHECK (is_active IN (0,1))
);

CREATE TABLE orders (
  order_id      INTEGER PRIMARY KEY,
  customer_id   TEXT    NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products(product_id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_price    REAL    NOT NULL,                           -- price snapshot at order time
  total_amount  REAL    NOT NULL,                           -- quantity * unit_price
  status        TEXT    NOT NULL CHECK (status IN
                  ('PENDING','PAID','SHIPPED','DELIVERED','CANCELLED','REFUNDED')),
  order_date    TEXT    NOT NULL,                           -- ISO 8601, fixed business dates
  scenario      TEXT    NOT NULL                            -- what this record is meant to test
);

CREATE TABLE payments (
  payment_id     INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES orders(order_id),
  method         TEXT    NOT NULL CHECK (method IN ('CARD','PROMPTPAY','BANK_TRANSFER','COD')),
  amount         REAL    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN
                   ('PENDING','SUCCESS','FAILED','REFUNDED','PARTIAL_REFUND')),
  paid_at        TEXT,                                      -- NULL when not paid
  refund_amount  REAL    NOT NULL DEFAULT 0
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_product  ON orders(product_id);
CREATE INDEX idx_payments_order  ON payments(order_id);
`);

// ---------- Golden data ----------
// products: id, sku, name, category, price, stock, active
const products = [
  [1, 'SKU-TSH-001', 'เสื้อยืดคอกลม',           'Apparel',     299,  120, 1],
  [2, 'SKU-MOU-001', 'Wireless Mouse',           'Electronics', 590,   45, 1],
  [3, 'SKU-KEY-001', 'Mechanical Keyboard',      'Electronics', 2490,  12, 1],
  [4, 'SKU-BTL-001', 'Water Bottle 750ml',       'Home',        350,    0, 1], // out of stock
  [5, 'SKU-NTB-001', 'Notebook A5',              'Stationery',  89,   500, 1],
  [6, 'SKU-CSE-001', 'Phone Case',               'Accessories', 199,   80, 1],
  [7, 'SKU-CBL-001', 'USB-C Cable 1m',           'Electronics', 149,  300, 1],
  [8, 'SKU-LMP-001', 'Desk Lamp (discontinued)', 'Home',        890,    3, 0], // inactive
];

// orders: id, customer, product, qty, unit_price, total, status, order_date, scenario
const orders = [
  [1001, 'C001', 1, 2,  299,  598, 'DELIVERED', '2026-11-01T09:15:00+07:00', 'Happy path: card paid, delivered'],
  [1002, 'C002', 3, 1, 2490, 2490, 'SHIPPED',   '2026-11-01T10:30:00+07:00', 'Happy path: PromptPay paid, shipped'],
  [1003, 'C003', 2, 1,  590,  590, 'PENDING',   '2026-11-01T11:00:00+07:00', 'Awaiting bank transfer (payment PENDING)'],
  [1004, 'C004', 5, 10,  89,  890, 'PAID',      '2026-11-01T12:20:00+07:00', 'Bulk quantity, paid, not yet shipped'],
  [1005, 'C005', 6, 1,  199,  199, 'CANCELLED', '2026-11-01T13:45:00+07:00', 'Card payment FAILED -> order cancelled'],
  [1006, 'C001', 7, 3,  149,  447, 'REFUNDED',  '2026-11-02T08:05:00+07:00', 'Full refund after payment'],
  [1007, 'C006', 3, 1, 2490, 2490, 'DELIVERED', '2026-11-02T09:40:00+07:00', 'Partial refund (500) after delivery'],
  [1008, 'C007', 2, 2,  590, 1180, 'CANCELLED', '2026-11-02T14:10:00+07:00', 'Edge: cancelled before any payment (no payment row)'],
  [1009, 'C008', 1, 1,  299,  299, 'SHIPPED',   '2026-11-03T10:00:00+07:00', 'COD: shipped, payment still PENDING'],
  [1010, 'C002', 4, 1,  350,  350, 'CANCELLED', '2026-11-03T15:30:00+07:00', 'Edge: product out of stock -> cancelled, no payment'],
  [1011, 'C009', 8, 1,  890,  890, 'DELIVERED', '2026-10-15T16:00:00+07:00', 'Historic order of now-inactive product'],
  [1012, 'C010', 5, 1,   89,   89, 'PAID',      '2026-11-03T18:25:00+07:00', 'Payment retry: first FAILED then SUCCESS'],
];

// payments: id, order, method, amount, status, paid_at, refund_amount
const payments = [
  [5001, 1001, 'CARD',          598,  'SUCCESS',        '2026-11-01T09:16:10+07:00',    0],
  [5002, 1002, 'PROMPTPAY',    2490,  'SUCCESS',        '2026-11-01T10:31:45+07:00',    0],
  [5003, 1003, 'BANK_TRANSFER', 590,  'PENDING',         null,                          0],
  [5004, 1004, 'CARD',          890,  'SUCCESS',        '2026-11-01T12:21:30+07:00',    0],
  [5005, 1005, 'CARD',          199,  'FAILED',          null,                          0],
  [5006, 1006, 'PROMPTPAY',     447,  'REFUNDED',       '2026-11-02T08:06:20+07:00',  447],
  [5007, 1007, 'CARD',         2490,  'PARTIAL_REFUND', '2026-11-02T09:41:05+07:00',  500],
  [5008, 1009, 'COD',           299,  'PENDING',         null,                          0],
  [5009, 1011, 'CARD',          890,  'SUCCESS',        '2026-10-15T16:01:00+07:00',    0],
  [5010, 1012, 'CARD',           89,  'FAILED',          null,                          0],
  [5011, 1012, 'PROMPTPAY',      89,  'SUCCESS',        '2026-11-03T18:27:40+07:00',    0],
];

function insertAll(sql, rows) {
  const stmt = db.prepare(sql);
  for (const r of rows) stmt.run(...r);
}

db.exec('BEGIN');
insertAll('INSERT INTO products VALUES (?,?,?,?,?,?,?)', products);
insertAll('INSERT INTO orders   VALUES (?,?,?,?,?,?,?,?,?)', orders);
insertAll('INSERT INTO payments VALUES (?,?,?,?,?,?,?)', payments);
db.exec('COMMIT');

db.exec('PRAGMA user_version = 1;'); // dataset version

// ---------- Reconciliation checks ----------
const checks = [
  ['orders.total_amount = quantity * unit_price',
   `SELECT COUNT(*) FROM orders WHERE total_amount <> quantity * unit_price`],
  ['orders.unit_price matches products.price',
   `SELECT COUNT(*) FROM orders o JOIN products p USING(product_id) WHERE o.unit_price <> p.price`],
  ['payments.amount = orders.total_amount',
   `SELECT COUNT(*) FROM payments p JOIN orders o USING(order_id) WHERE p.amount <> o.total_amount`],
  ['REFUNDED/PARTIAL payments have refund_amount > 0 (and others = 0)',
   `SELECT COUNT(*) FROM payments WHERE
      (status IN ('REFUNDED','PARTIAL_REFUND') AND refund_amount <= 0)
      OR (status NOT IN ('REFUNDED','PARTIAL_REFUND') AND refund_amount <> 0)`],
  ['SUCCESS/REFUNDED/PARTIAL payments have paid_at; others do not',
   `SELECT COUNT(*) FROM payments WHERE
      (status IN ('SUCCESS','REFUNDED','PARTIAL_REFUND') AND paid_at IS NULL)
      OR (status IN ('PENDING','FAILED') AND paid_at IS NOT NULL)`],
  ['PAID/SHIPPED/DELIVERED orders (non-COD) have a successful payment',
   `SELECT COUNT(*) FROM orders o WHERE o.status IN ('PAID','SHIPPED','DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.order_id
                      AND (p.status IN ('SUCCESS','PARTIAL_REFUND') OR p.method = 'COD'))`],
  ['No orphan payments / orders (FK check)',
   `SELECT COUNT(*) FROM pragma_foreign_key_check`],
];

let failed = 0;
for (const [name, sql] of checks) {
  const n = db.prepare(sql).get()['COUNT(*)'];
  console.log(`${n === 0 ? 'PASS' : 'FAIL'}  ${name}${n ? `  (violations: ${n})` : ''}`);
  if (n) failed++;
}

for (const t of ['products', 'orders', 'payments']) {
  console.log(`${t.padEnd(9)} rows: ${db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`);
}
db.close();

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nGolden dataset written to ${OUT}`);
