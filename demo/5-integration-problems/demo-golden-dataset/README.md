# Golden dataset
ข้อมูลมี 3 ตาราง
1. products 8 รายการ รวมสินค้าหมดสต็อก 1 รายการและสินค้าเลิกขาย (inactive) 1 รายการ
2. orders 12 รายการ มีคอลัมน์ scenario บอกว่าแต่ละแถวใช้ทดสอบอะไร
3. payments 11 รายการ

## ข้อมูล
* ข้อมูลเป็นแบบ deterministic คือรันกี่ครั้งก็ได้ไฟล์เดิม วันที่ถูกกำหนดไว้ที่ 2026-10-15 ถึง 2026-11-03 และตั้ง user_version = 1 ไว้เป็นเวอร์ชันของ dataset
* ท้าย script มี reconciliation check 7 ข้อ ดังนี้

| # | กฎที่ตรวจ | ตรวจอะไร |
|---|---|---|
| 1 | `orders.total_amount = quantity × unit_price` | ยอดรวมของ order ต้องเท่ากับจำนวน × ราคาต่อหน่วย |
| 2 | `orders.unit_price` ตรงกับ `products.price` | ราคาที่บันทึกใน order ต้องตรงกับราคาสินค้า (ณ ชุดข้อมูลนี้) |
| 3 | `payments.amount = orders.total_amount` | ยอดที่ต้องจ่ายต้องเท่ากับยอด order |
| 4 | `refund_amount` สอดคล้องกับ status | status เป็น REFUNDED/PARTIAL_REFUND ต้องมี refund_amount > 0 ส่วน status อื่นต้องเป็น 0 |
| 5 | `paid_at` สอดคล้องกับ status | SUCCESS/REFUNDED/PARTIAL_REFUND ต้องมี paid_at ส่วน PENDING/FAILED ต้องเป็น NULL |
| 6 | order ที่จ่ายแล้วต้องมี payment รองรับ | order สถานะ PAID/SHIPPED/DELIVERED ต้องมี payment สถานะ SUCCESS หรือ PARTIAL_REFUND หรือเป็น COD |
| 7 | Foreign key ไม่มี orphan | `orders.product_id` ต้องมีใน `products` และ `payments.order_id` ต้องมีใน `orders` (ใช้ `pragma_foreign_key_check`) |


## Run to generate data
```
node --disable-warning=ExperimentalWarning build-golden-db.mjs golden_ecommerce.db
```

## Run to check data in each scenario
```
node scenario-queries.mjs
```

| # | Scenario | Order ที่ได้ | เงื่อนไขหลักใน query |
|---|---|---|---|
| 1 | จ่ายด้วยบัตรสำเร็จ ส่งของแล้ว | 1001 | `o.status='DELIVERED' AND p.status='SUCCESS' AND p.method='CARD'` |
| 2 | จ่าย PromptPay สำเร็จ กำลังส่ง | 1002 | `o.status='SHIPPED' AND p.method='PROMPTPAY'` |
| 3 | รอโอนเงิน | 1003 | `o.status='PENDING' AND p.status='PENDING'` |
| 4 | สั่งจำนวนมาก จ่ายแล้วยังไม่ส่ง | 1004 | `o.status='PAID' AND o.quantity>=10` |
| 5 | จ่ายบัตรไม่ผ่าน แล้วยกเลิก | 1005 | `o.status='CANCELLED' AND p.status='FAILED'` และไม่มี SUCCESS |
| 6 | คืนเงินเต็มจำนวน | 1006 | `p.status='REFUNDED' AND p.refund_amount = p.amount` |
| 7 | คืนเงินบางส่วน | 1007 | `p.status='PARTIAL_REFUND'` พร้อมคำนวณ `net_amount` |
| 8 | ยกเลิกก่อนมี payment | 1008, 1010 | `LEFT JOIN payments ... WHERE p.payment_id IS NULL` |
| 9 | COD ส่งแล้ว ยังไม่เก็บเงิน | 1009 | `p.method='COD' AND p.status='PENDING'` |
| 10 | สินค้าหมดสต็อก ยกเลิก | 1010 | `pr.stock_qty=0 AND o.status='CANCELLED'` |
| 11 | order เก่าของสินค้าเลิกขาย | 1011 | `pr.is_active=0` |
| 12 | จ่ายซ้ำหลัง fail | 1012 | `GROUP BY order_id HAVING failed_attempts>=1 AND success_attempts=1` |