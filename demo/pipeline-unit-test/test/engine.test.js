'use strict';
// ทดสอบตัว engine เอง: ชุดตัวอย่างต้องจับข้อผิดพลาดที่แฝงไว้ได้ครบ  (node --test)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { run } = require('../src/runner');

const I = path.join(__dirname, '..', 'input');
test('sample project: detects every planted defect', async () => {
  const r = await run({ mappingFile: `${I}/mapping_spec.xlsx`, ddlDir: `${I}/ddl`, sqlDir: `${I}/sql`, dataDir: `${I}/data` });
  const bad = (cat, table, col, text) => r.tests.some((t) => t.cat === cat && t.table === table && t.column === col && t.status === 'FAIL' && (t.description + t.detail).includes(text));
  assert.ok(bad('STR', 'dim_customer', 'country_code', 'Data type'));
  assert.ok(bad('STR', 'dim_customer', 'loyalty_tier', 'exists in target DDL'));
  assert.ok(bad('SQL', 'fact_orders', 'item_count', 'populated'));
  assert.ok(bad('DAT', 'dim_customer', 'email', 'expected'));
  assert.ok(bad('DAT', 'fact_orders', 'order_status', 'RETURNED'));
  assert.ok(bad('EXE', 'fact_order_items', '', 'UNIQUE'));
  assert.ok(bad('EXC', 'dim_customer', 'email', 'VARCHAR(100)'));
  assert.ok(bad('SRC', 'stg_order_items', 'order_item_id', 'duplicate') || r.tests.some((t) => t.cat === 'SRC' && t.status === 'FAIL' && /ซ้ำ/.test(t.detail)));
  // และต้องไม่มี false positive ในคอลัมน์ที่ถูกต้อง
  const ok = (cat, table, col) => r.tests.filter((t) => t.cat === cat && t.table === table && t.column === col).every((t) => t.status !== 'FAIL');
  assert.ok(ok('DAT', 'fact_orders', 'net_amount'));
  assert.ok(ok('DAT', 'dim_customer', 'full_name'));
  assert.ok(ok('STR', 'fact_orders', 'gross_amount'));
});
