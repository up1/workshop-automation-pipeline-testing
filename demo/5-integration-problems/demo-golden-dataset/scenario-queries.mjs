// Example queries for each Golden dataset scenario.
// Usage: node scenario-queries.mjs [golden_ecommerce.db]
// Each query is run and its returned order_ids are compared with the expected ones.

import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2] ?? 'golden_ecommerce.db', { readOnly: true });

const scenarios = [
  {
    name: '1. Happy path: card paid, delivered',
    expect: [1001],
    sql: `SELECT o.order_id, o.status, p.method, p.status AS pay_status, p.amount
          FROM orders o JOIN payments p USING(order_id)
          WHERE o.status = 'DELIVERED' AND p.status = 'SUCCESS' AND p.method = 'CARD'
            AND o.order_date >= '2026-11-01'`,
  },
  {
    name: '2. Happy path: PromptPay paid, shipped',
    expect: [1002],
    sql: `SELECT o.order_id, o.status, p.method, p.status AS pay_status, p.amount
          FROM orders o JOIN payments p USING(order_id)
          WHERE o.status = 'SHIPPED' AND p.status = 'SUCCESS' AND p.method = 'PROMPTPAY'`,
  },
  {
    name: '3. Awaiting bank transfer (payment PENDING)',
    expect: [1003],
    sql: `SELECT o.order_id, o.status, p.method, p.status AS pay_status, p.paid_at
          FROM orders o JOIN payments p USING(order_id)
          WHERE o.status = 'PENDING' AND p.status = 'PENDING' AND p.method = 'BANK_TRANSFER'`,
  },
  {
    name: '4. Bulk quantity, paid, not yet shipped',
    expect: [1004],
    sql: `SELECT o.order_id, o.quantity, o.total_amount, o.status
          FROM orders o
          WHERE o.status = 'PAID' AND o.quantity >= 10`,
  },
  {
    name: '5. Card payment FAILED -> order cancelled',
    expect: [1005],
    sql: `SELECT o.order_id, o.status, p.status AS pay_status
          FROM orders o JOIN payments p USING(order_id)
          WHERE o.status = 'CANCELLED' AND p.status = 'FAILED'
            AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.order_id = o.order_id AND x.status = 'SUCCESS')`,
  },
  {
    name: '6. Full refund after payment',
    expect: [1006],
    sql: `SELECT o.order_id, o.status, p.amount, p.refund_amount
          FROM orders o JOIN payments p USING(order_id)
          WHERE o.status = 'REFUNDED' AND p.status = 'REFUNDED' AND p.refund_amount = p.amount`,
  },
  {
    name: '7. Partial refund after delivery',
    expect: [1007],
    sql: `SELECT o.order_id, o.status, p.amount, p.refund_amount,
                 p.amount - p.refund_amount AS net_amount
          FROM orders o JOIN payments p USING(order_id)
          WHERE p.status = 'PARTIAL_REFUND' AND p.refund_amount < p.amount`,
  },
  {
    name: '8. Edge: cancelled before any payment (no payment row)',
    expect: [1008, 1010],
    sql: `SELECT o.order_id, o.status, o.scenario
          FROM orders o LEFT JOIN payments p USING(order_id)
          WHERE p.payment_id IS NULL`,
  },
  {
    name: '9. COD: shipped, payment still PENDING',
    expect: [1009],
    sql: `SELECT o.order_id, o.status, p.method, p.status AS pay_status, p.paid_at
          FROM orders o JOIN payments p USING(order_id)
          WHERE p.method = 'COD' AND p.status = 'PENDING' AND o.status = 'SHIPPED'`,
  },
  {
    name: '10. Edge: product out of stock -> cancelled, no payment',
    expect: [1010],
    sql: `SELECT o.order_id, o.status, pr.name, pr.stock_qty
          FROM orders o JOIN products pr USING(product_id)
          WHERE pr.stock_qty = 0 AND o.status = 'CANCELLED'`,
  },
  {
    name: '11. Historic order of now-inactive product',
    expect: [1011],
    sql: `SELECT o.order_id, o.order_date, pr.name, pr.is_active, o.status
          FROM orders o JOIN products pr USING(product_id)
          WHERE pr.is_active = 0`,
  },
  {
    name: '12. Payment retry: first FAILED then SUCCESS',
    expect: [1012],
    sql: `SELECT o.order_id, COUNT(*) AS attempts,
                 SUM(p.status = 'FAILED')  AS failed_attempts,
                 SUM(p.status = 'SUCCESS') AS success_attempts
          FROM orders o JOIN payments p USING(order_id)
          GROUP BY o.order_id
          HAVING failed_attempts >= 1 AND success_attempts = 1`,
  },
];

let failed = 0;
for (const s of scenarios) {
  const rows = db.prepare(s.sql).all();
  const ids = rows.map(r => Number(r.order_id)).sort((a, b) => a - b);
  const ok = JSON.stringify(ids) === JSON.stringify(s.expect);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}  -> order_id [${ids}]`);
}
db.close();
process.exit(failed ? 1 : 0);
