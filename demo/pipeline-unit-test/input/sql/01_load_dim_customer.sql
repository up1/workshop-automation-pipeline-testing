-- Load dim_customer from stg_customers
INSERT INTO dim_customer (customer_key, full_name, email, country_code, created_date)
SELECT
  c.customer_id,
  TRIM(c.first_name) || ' ' || TRIM(c.last_name),
  LOWER(c.email),                 -- BUG: ลืม TRIM
  UPPER(c.country),
  DATE(c.created_at)
FROM stg_customers c;
