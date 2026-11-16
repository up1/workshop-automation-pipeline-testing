'use strict';
/**
 * สร้างชุดข้อมูลตัวอย่าง (E-commerce orders) สำหรับทดลองระบบ
 * มีการแฝงข้อผิดพลาดไว้โดยตั้งใจ เพื่อให้เห็นว่า Test จับได้อย่างไร
 *   node scripts/generate-sample.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'input');
for (const d of ['ddl', 'sql', 'data']) fs.mkdirSync(path.join(IN, d), { recursive: true });
const write = (rel, txt) => fs.writeFileSync(path.join(IN, rel), txt.replace(/^\n/, ''));

// ---------------------------------------------------------------- DDL
write('ddl/01_source_tables.sql', `
-- Staging (source) tables
CREATE TABLE stg_customers (
  customer_id INT NOT NULL,
  first_name  VARCHAR(50),
  last_name   VARCHAR(50),
  email       VARCHAR(200),
  country     VARCHAR(3),
  created_at  TIMESTAMP,
  PRIMARY KEY (customer_id)
);

CREATE TABLE stg_orders (
  order_id    INT NOT NULL,
  customer_id INT NOT NULL,
  order_ts    TIMESTAMP NOT NULL,
  status      VARCHAR(20),
  discount    DECIMAL(10,2),
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES stg_customers (customer_id)
);

CREATE TABLE stg_order_items (
  order_item_id INT NOT NULL,
  order_id      INT NOT NULL,
  product_sku   VARCHAR(30) NOT NULL,
  quantity      INT NOT NULL,
  unit_price    DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_item_id),
  FOREIGN KEY (order_id) REFERENCES stg_orders (order_id)
);
`);

write('ddl/02_target_tables.sql', `
-- Data warehouse (target) tables
CREATE TABLE dim_customer (
  customer_key INT NOT NULL,
  full_name    VARCHAR(101),
  email        VARCHAR(100),
  country_code VARCHAR(3),          -- Mapping Spec ระบุ VARCHAR(2)  (ตั้งใจให้ไม่ตรง)
  created_date DATE,
  PRIMARY KEY (customer_key)
);

CREATE TABLE fact_orders (
  order_id        INT NOT NULL,
  customer_key    INT NOT NULL,
  order_date      DATE NOT NULL,
  order_status    VARCHAR(20) NOT NULL,
  gross_amount    DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL,
  net_amount      DECIMAL(12,2) NOT NULL,
  item_count      INT,
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_key) REFERENCES dim_customer (customer_key)
);

CREATE TABLE fact_order_items (
  order_item_id INT NOT NULL,
  order_id      INT NOT NULL,
  product_sku   VARCHAR(30) NOT NULL,
  quantity      INT NOT NULL,
  unit_price    DECIMAL(10,2) NOT NULL,
  line_amount   DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (order_item_id)
);
`);

// ---------------------------------------------------------------- SQL scripts
write('sql/01_load_dim_customer.sql', `
-- Load dim_customer from stg_customers
INSERT INTO dim_customer (customer_key, full_name, email, country_code, created_date)
SELECT
  c.customer_id,
  TRIM(c.first_name) || ' ' || TRIM(c.last_name),
  LOWER(c.email),                 -- BUG: ลืม TRIM
  UPPER(c.country),
  DATE(c.created_at)
FROM stg_customers c;
`);

write('sql/02_load_fact_orders.sql', `
-- Load fact_orders (1 row / order)
-- BUG 1: ไม่ได้ INSERT คอลัมน์ item_count
-- BUG 2: CASE ไม่มี 'RETURNED'
INSERT INTO fact_orders
  (order_id, customer_key, order_date, order_status, gross_amount, discount_amount, net_amount)
SELECT
  o.order_id,
  o.customer_id,
  DATE(o.order_ts),
  CASE o.status
    WHEN 'DELIVERED' THEN 'COMPLETED'
    WHEN 'SHIPPED'   THEN 'IN_TRANSIT'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'UNKNOWN'
  END,
  COALESCE(SUM(i.quantity * i.unit_price), 0),
  COALESCE(o.discount, 0),
  COALESCE(SUM(i.quantity * i.unit_price), 0) - COALESCE(o.discount, 0)
FROM stg_orders o
LEFT JOIN stg_order_items i ON i.order_id = o.order_id
GROUP BY o.order_id, o.customer_id, o.order_ts, o.status, o.discount;
`);

write('sql/03_load_fact_order_items.sql', `
-- Load fact_order_items (ถูกต้องตาม Spec แต่ข้อมูลต้นทางมี order_item_id ซ้ำ -> เกิด Exception)
INSERT INTO fact_order_items (order_item_id, order_id, product_sku, quantity, unit_price, line_amount)
SELECT
  i.order_item_id,
  i.order_id,
  i.product_sku,
  i.quantity,
  i.unit_price,
  i.quantity * i.unit_price
FROM stg_order_items i
WHERE i.quantity > 0;
`);

// ---------------------------------------------------------------- Sample data (CSV)
const longEmail = 'very.long.mailbox.name.' + 'x'.repeat(80) + '@example-company-domain.com';
write('data/stg_customers.csv', `
customer_id,first_name,last_name,email,country,created_at
1,Somchai,Jaidee,somchai@example.com,th,2025-01-05 09:12:00
2,Malee,Srisuk,  Malee.S@Example.com ,TH,2025-01-18 14:30:00
3,John,Smith,john.smith@example.com,us,2025-02-02 08:00:00
4, Anna ,Lee,anna.lee@example.com,sg,2025-02-14 19:45:00
5,Wei,Chen, WEI.CHEN@EXAMPLE.COM,cn,2025-03-01 10:10:00
6,Priya,Patel,priya.patel@example.com,in,2025-13-45 00:00:00
7,Hans,Mueller,hans.mueller@example.com,de,2025-03-20 11:11:00
8,Long,Email,${longEmail},jp,2025-04-01 12:00:00
`);

write('data/stg_orders.csv', `
order_id,customer_id,order_ts,status,discount
1001,1,2025-05-01 10:00:00,DELIVERED,0
1002,2,2025-05-02 11:30:00,SHIPPED,50.00
1003,3,2025-05-03 09:15:00,CANCELLED,
1004,1,2025-05-04 16:20:00,RETURNED,10.00
1005,4,2025-05-05 13:05:00,DELIVERED,
1006,5,2025-05-06 08:40:00,PENDING,25.50
1007,7,2025-05-07 20:10:00,DELIVERED,100.00
1008,99,2025-05-08 12:00:00,SHIPPED,0
`);

write('data/stg_order_items.csv', `
order_item_id,order_id,product_sku,quantity,unit_price
5001,1001,SKU-A,2,150.00
5002,1001,SKU-B,1,299.99
5003,1002,SKU-C,3,89.50
5004,1003,SKU-A,1,150.00
5005,1004,SKU-D,1,1200.00
5006,1005,SKU-B,2,299.99
5007,1006,SKU-E,4,35.25
5008,1007,SKU-A,5,150.00
5008,1007,SKU-F,1,500.00
5009,1008,SKU-C,1,89.50
5010,1006,SKU-G,0,10.00
`);

// ---------------------------------------------------------------- Mapping Spec (.xlsx)
async function mappingSpec() {
  const wb = new ExcelJS.Workbook();

  const t = wb.addWorksheet('Tables');
  t.addRow(['Target Table', 'Load Order', 'SQL File', 'Source FROM', 'Filter (WHERE)', 'Group By']);
  t.addRow(['dim_customer', 1, '01_load_dim_customer.sql', 'stg_customers c', '', '']);
  t.addRow(['fact_orders', 2, '02_load_fact_orders.sql',
    'stg_orders o LEFT JOIN stg_order_items i ON i.order_id = o.order_id', '',
    'o.order_id, o.customer_id, o.order_ts, o.status, o.discount']);
  t.addRow(['fact_order_items', 3, '03_load_fact_order_items.sql', 'stg_order_items i', 'i.quantity > 0', '']);

  const c = wb.addWorksheet('Columns');
  c.addRow(['Target Table', 'Target Column', 'Data Type', 'Nullable', 'PK', 'Transformation Rule', 'Description']);
  const R = (...a) => c.addRow(a);
  // dim_customer
  R('dim_customer', 'customer_key', 'INT', 'N', 'Y', 'c.customer_id', 'Surrogate = source id');
  R('dim_customer', 'full_name', 'VARCHAR(101)', 'Y', 'N', "TRIM(c.first_name) || ' ' || TRIM(c.last_name)", 'ชื่อ-นามสกุล');
  R('dim_customer', 'email', 'VARCHAR(100)', 'Y', 'N', 'LOWER(TRIM(c.email))', 'อีเมลตัวพิมพ์เล็ก ไม่มีช่องว่าง');
  R('dim_customer', 'country_code', 'VARCHAR(2)', 'Y', 'N', 'UPPER(c.country)', 'รหัสประเทศ');
  R('dim_customer', 'created_date', 'DATE', 'Y', 'N', 'DATE(c.created_at)', 'วันที่สมัคร');
  R('dim_customer', 'loyalty_tier', 'VARCHAR(10)', 'Y', 'N',
    "CASE WHEN c.loyalty_points > 1000 THEN 'GOLD' ELSE 'STANDARD' END", 'ระดับสมาชิก (ยังไม่มีใน DDL)');
  // fact_orders
  R('fact_orders', 'order_id', 'INT', 'N', 'Y', 'o.order_id', '');
  R('fact_orders', 'customer_key', 'INT', 'N', 'N', 'o.customer_id', 'FK -> dim_customer');
  R('fact_orders', 'order_date', 'DATE', 'N', 'N', 'DATE(o.order_ts)', '');
  R('fact_orders', 'order_status', 'VARCHAR(20)', 'N', 'N',
    "CASE o.status WHEN 'DELIVERED' THEN 'COMPLETED' WHEN 'SHIPPED' THEN 'IN_TRANSIT' WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'RETURNED' THEN 'RETURNED' ELSE 'UNKNOWN' END",
    'แปลงสถานะ');
  R('fact_orders', 'gross_amount', 'DECIMAL(12,2)', 'N', 'N', 'COALESCE(SUM(i.quantity * i.unit_price), 0)', 'ยอดก่อนส่วนลด');
  R('fact_orders', 'discount_amount', 'DECIMAL(12,2)', 'N', 'N', 'COALESCE(o.discount, 0)', '');
  R('fact_orders', 'net_amount', 'DECIMAL(12,2)', 'N', 'N',
    'COALESCE(SUM(i.quantity * i.unit_price), 0) - COALESCE(o.discount, 0)', 'ยอดสุทธิ');
  R('fact_orders', 'item_count', 'INT', 'Y', 'N', 'COUNT(i.order_item_id)', 'จำนวนรายการ');
  // fact_order_items
  R('fact_order_items', 'order_item_id', 'INT', 'N', 'Y', 'i.order_item_id', '');
  R('fact_order_items', 'order_id', 'INT', 'N', 'N', 'i.order_id', '');
  R('fact_order_items', 'product_sku', 'VARCHAR(30)', 'N', 'N', 'i.product_sku', '');
  R('fact_order_items', 'quantity', 'INT', 'N', 'N', 'i.quantity', '');
  R('fact_order_items', 'unit_price', 'DECIMAL(10,2)', 'N', 'N', 'i.unit_price', '');
  R('fact_order_items', 'line_amount', 'DECIMAL(12,2)', 'N', 'N', 'i.quantity * i.unit_price', 'qty x price');

  for (const ws of [t, c]) {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    ws.columns.forEach((col, i) => { col.width = [18, 16, 28, 60, 60, 60, 36][i] || 20; });
  }
  c.getColumn(6).width = 70;
  await wb.xlsx.writeFile(path.join(IN, 'mapping_spec.xlsx'));
}

mappingSpec().then(() => console.log('Sample inputs generated in', IN));
