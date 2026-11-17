# Pipeline Unit Test (NodeJS)

ตรวจสอบ Data Pipeline อัตโนมัติ: **Mapping Spec (.xlsx) ↔ DDL ↔ SQL Scripts ↔ Sample Data**
แล้วออกรายงาน Excel (Pass / Fail / Warning / Skipped พร้อม Error และ Exception)

## ใช้งาน
```bash
npm install
npm run sample      # สร้างข้อมูลตัวอย่าง e-commerce orders (มีข้อผิดพลาดแฝงไว้)
npm run report     # รัน CLI -> output/unit_test_report.xlsx  (exit 1 ถ้ามี FAIL)
npm test            # ทดสอบตัว engine เอง
npm run serve       # หน้า Upload: http://localhost:3000
```
CLI: `node src/cli.js --mapping x.xlsx --ddl dir --sql dir --data dir --out report.xlsx`
ต้องใช้ Node >= 22.5 (ใช้ `node:sqlite` ในตัว ไม่ต้องติดตั้ง database)

## รูปแบบ Input
**Mapping Spec** มี 2 sheet (ชื่อหัวคอลัมน์ยืดหยุ่น ดู `src/readers.js`)
- `Tables`: Target Table | Load Order | SQL File | Source FROM | Filter (WHERE) | Group By
- `Columns`: Target Table | Target Column | Data Type | Nullable (Y/N) | PK (Y/N) | Transformation Rule | Description

`Transformation Rule` เขียนเป็น SQL expression เหนือคอลัมน์ต้นทาง (เช่น `LOWER(TRIM(c.email))`)
**DDL**: ไฟล์ `.sql` ที่มี `CREATE TABLE` (ตาราง target = ตารางที่อยู่ใน Mapping ที่เหลือคือ source)
**SQL**: ไฟล์ `.sql` รูปแบบ `INSERT INTO t (cols) SELECT ... FROM ...`
**Sample Data**: `<ชื่อตาราง>.csv` / `.json` / `.xlsx` (sheet = ชื่อตาราง) ของตาราง source

## หลักการ: Expected vs Actual
1. โหลด Sample Data เข้า SQLite in-memory (source tables ไม่ใส่ constraint เพื่อให้ตรวจข้อมูลเสียได้)
2. รัน **Transformation Rule จาก Spec** กับ Sample Data = ผลลัพธ์ที่ *คาดหวัง* (Oracle)
3. รัน **SQL Script จริง** กับ target tables ที่สร้างจาก DDL = ผลลัพธ์ *จริง*
4. เทียบกันรายคอลัมน์ผ่าน PK ที่ระบุใน Spec

## Test Cases
| Prefix | กลุ่ม | ตรวจอะไร |
|---|---|---|
| STR | Spec vs DDL | ตาราง/คอลัมน์มีจริง, Data type, Nullable, PK ตรงกัน, rule อ้างอิงคอลัมน์ที่มีใน DDL |
| SQL | Spec vs SQL | คอลัมน์ถูก INSERT ครบ/ไม่เกิน, จำนวน column=expression, expression ตรงกับ rule, FROM/WHERE/GROUP BY ตรงกับ Spec |
| SRC | Source data | PK ซ้ำ, NOT NULL, ชนิดข้อมูล/ความยาว/วันที่, FK orphan, คอลัมน์ครบตาม DDL |
| EXC | Exception pre-check | rule รันได้ไหม, ค่าที่ได้ละเมิด NOT NULL/ความยาว/precision หรือไม่ , หารด้วยศูนย์ |
| EXE | Execution | DDL/SQL รันได้หรือไม่ (จับ error จริงเช่น UNIQUE violation), FK หลังโหลด |
| DAT | Data validation | row count, key ครบ/ไม่เกิน, PK ไม่ซ้ำ, ค่ารายคอลัมน์เท่ากับ rule |

## รายงาน Excel
`Summary` (verdict, สรุปตามกลุ่ม/ตาราง, รายการ input) · `Test Cases` (filter ได้) ·
`Failure Details` (ระดับแถว: key / expected / actual) · `Exceptions` (error message + SQL ที่เกิดปัญหา)

## ข้อจำกัด / ต้องรู้
- Engine เป็น **SQLite**: SQL ที่ใช้ฟังก์ชันเฉพาะ DB อื่น (เช่น `DATEADD`, `NVL`) จะรันไม่ได้ ต้องปรับสคริปต์ หรือเขียน adapter ใหม่แทน `DatabaseSync` ใน `src/runner.js`
- SQLite ไม่บังคับความยาว VARCHAR และไม่ error เมื่อหารศูนย์ จึงมี EXC test ตรวจแทนล่วงหน้า
- SELECT alias ต้องเขียนแบบ `AS name` (ไม่รองรับ alias แบบไม่มี AS); เทียบ expression แบบข้อความ ผลต่างจะเป็น WARN โดยให้ DAT เป็นตัวตัดสิน
- ตรวจ reference ของ rule แบบ heuristic (ไม่ใช่ SQL parser เต็มรูปแบบ); FROM ที่มี subquery จะข้ามการตรวจ reference

## ข้อผิดพลาดที่แฝงในข้อมูลตัวอย่าง
`country_code` VARCHAR(2) vs (3) · `loyalty_tier` ไม่มีใน DDL/SQL/ต้นทาง · `email` ลืม TRIM ·
`order_status` ไม่มี RETURNED · `item_count` ไม่ถูก INSERT · order_item_id ซ้ำ (UNIQUE exception) ·
customer 99 ไม่มี (FK orphan) · email ยาวเกิน 100 · created_at วันที่ผิด
