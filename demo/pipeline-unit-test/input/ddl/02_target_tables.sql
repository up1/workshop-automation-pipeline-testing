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
