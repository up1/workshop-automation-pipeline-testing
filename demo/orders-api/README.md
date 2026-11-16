# orders-api

ตัวอย่าง Node.js + Express + node:sqlite (built-in) พร้อม automated test ที่ไม่ขึ้นกับ data movement

- `createApp(db)` รับ DB จากภายนอก (dependency injection)
- ทุก test ได้ in-memory DB ใหม่ และสร้างข้อมูลเองด้วย data builder (`test/helpers.js`)
- assert "กฎ/สัญญา" ไม่ assert ค่าตายตัว

## ใช้งาน
    npm install
    npm test        # ต้องใช้ Node 22+
    npm start       # GET http://localhost:3000/orders?customerId=1
