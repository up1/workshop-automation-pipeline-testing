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
