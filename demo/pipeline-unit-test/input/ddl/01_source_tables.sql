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
