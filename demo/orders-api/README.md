# orders-api

ตัวอย่าง Node.js + Express + node:sqlite (built-in) พร้อม automated test ที่ไม่ขึ้นกับ data movement

- `createApp(db)` รับ DB จากภายนอก (dependency injection)
- ทุก test ได้ in-memory DB ใหม่ และสร้างข้อมูลเองด้วย data builder (`test/helpers.js`)
- assert "กฎ/สัญญา" ไม่ assert ค่าตายตัว (Contract test)

## ใช้งาน
    npm install
    npm test        # ต้องใช้ Node 22+
    npm start       # GET http://localhost:3000/orders?customerId=1


## แนวคิดหลัก: ทำให้ข้อมูลเป็น "ตัวแปรที่ควบคุมได้"
### 1. ควบคุมข้อมูลที่ต้นทาง (ได้ผลที่สุด)
* Test data ของตัวเอง: ให้แต่ละ test สร้างข้อมูลที่ต้องใช้เอง (data builder/factory) แล้วลบทิ้งหลังจบ ไม่ใช้ข้อมูลที่คนอื่นหรือระบบอื่นแก้ได้
* Seed/fixture คงที่: DB สำหรับ test ถูก reset เป็นสถานะที่รู้แน่นอนก่อนรัน เช่น ใช้ Testcontainers, Docker หรือ snapshot/restore
* Isolation: แยก schema หรือ tenant ต่อ test run เพื่อไม่ให้ test ชนกัน

### 2. Assert สิ่งที่คงที่ ไม่ assert ค่าที่เปลี่ยนแปลง
* เช็ก โครงสร้างและกฎ ไม่ใช่ค่าตายตัว เช่น field ครบ, type ถูก, ผลรวมของรายการเท่ากับยอดรวม, ผลลัพธ์เรียงตามที่กำหนด
* ใช้ assertion แบบสัมพัทธ์ เช่น "ค้นหา order ที่เพิ่งสร้าง ต้องเจอ 1 รายการ" แทน "ต้องมี order 1,532 รายการ"
* ทำ contract test ให้ API/query คืนรูปแบบตามสัญญาเสมอ ไม่ว่าข้อมูลข้างในเป็นอะไร

### 3. แยกชั้นของ test ตามระดับการใช้งานข้อมูล
| ชั้น | ข้อมูล | รันเมื่อไหร่ |
|---|---|---|
| Unit test | mock ทั้งหมด | ทุก commit/PR |
| Integration test | seed DB ใน container | ทุก PR |
| E2E / smoke | staging + test data ที่สร้างเอง | หลัง deploy ขึ้น staging |
| Regression ใหญ่ | snapshot ข้อมูลจริงที่ mask แล้ว | nightly |
| Synthetic monitoring | production (read-only, query ปลอดภัย) | ทุกไม่กี่นาที/ชั่วโมง |

### 4. แยก “test ระบบ” ออกจาก “test คุณภาพข้อมูล”
* ถ้าห่วงว่าข้อมูลใน DB เปลี่ยนทิศทางผิดปกติ นั่นคือเรื่อง `data quality monitoring` ไม่ใช่ functional test 
* เช่น เช็กค่า null เกินเกณฑ์, row count กระโดด, ค่าอยู่นอกช่วง (Great Expectations, dbt tests, Soda) เครื่องมือกลุ่มนี้เหมาะกับการรันตามเวลา แล้วแจ้งเตือน ไม่ควรให้ block deploy