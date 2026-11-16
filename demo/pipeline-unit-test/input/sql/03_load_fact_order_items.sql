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
