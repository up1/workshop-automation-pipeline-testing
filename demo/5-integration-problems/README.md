# System integration

## Root cause analysis !!
```
สาเหตุหลักที่ช้า

ข้อมูลที่ต้อง link กันข้ามระบบ เช่น Customer ID, Account No. หรือ Contract No. 
ถูกสร้างและปรับด้วยมือทีละระบบ ลำดับการสร้างไม่ชัด และเมื่อข้อมูลถูกใช้จนเปลี่ยนสถานะแล้วต้องทำใหม่ทั้งชุด
```

## Solution 1 :: สร้าง “Golden Dataset” ที่ sync กันไว้ล่วงหน้า (ผลเร็วที่สุด)
* ออกแบบชุดข้อมูลมาตรฐานที่ครอบคลุม scenario หลัก เช่น ปกติ, ค้างชำระ, ปิดบัญชี, edge case
* ใช้ business key ร่วมกันทุกระบบ ให้ RM, ST, IM, DCS อ้างอิงถึงกันได้ตั้งแต่ต้น
* ทำ snapshot (DB backup หรือ container image) แล้ว restore เมื่อข้อมูลเสีย แทนการสร้างใหม่

## Solution 2 :: ทำ Test Data Seeder แบบ Orchestration (ผลระยะกลาง)
* เขียน script หรือ tool ตัวเดียว รับ input เป็น scenario (เช่น YAML/JSON) แล้วยิงข้อมูลเข้าแต่ละระบบตามลำดับ dependency
* ใช้ API หรือ batch loader ของแต่ละระบบ และมี correlation ID กลางสำหรับเก็บ key ที่สร้างได้
* รองรับ cleanup/reset ใน tool เดียวกัน
* เปลี่ยนงานที่ใช้หลายชั่วโมงเป็นสั่งรันครั้งเดียว

## Solution 3 :: ใช้ Service Virtualization / Stub กับระบบที่ไม่ใช่เป้าหมายทดสอบ
* ถ้าทดสอบ RM โดยตรง ไม่จำเป็นต้องมี DCS จริงทุกครั้ง ใช้ mock/stub ที่ตอบข้อมูลตาม scenario ได้ (WireMock, MockServer, Stubby)
* ลดจำนวนระบบที่ต้อง sync ลง และเก็บ integration test กับระบบจริงไว้รอบ SIT เท่านั้น

## Solution 4 :: Subset + Masking จาก Production
* ดึงข้อมูลที่สัมพันธ์กันข้ามระบบจาก Production ผ่าน key เดียวกัน แล้ว mask ข้อมูลส่วนบุคคล (สำคัญเรื่อง PDPA)
* ได้ข้อมูลสมจริง และความสัมพันธ์ข้ามระบบถูกต้องอยู่แล้ว
* เหมาะกับ regression และ UAT มากกว่า unit test

## Solution 5 :: Self-service และจัดการข้อมูล
* ทำ Test Data Catalog ให้รู้ว่า record ไหนใช้ scenario อะไร ใครจองอยู่ (reservation) ป้องกันทีมแย่งใช้ข้อมูลเดียวกันจนสถานะเพี้ยน
* ทำ portal หรือ pipeline job ให้ QA กดขอข้อมูลเองได้ แทนการรอทีมที่ทำ mock

## แผนที่แนะนำ
| ระยะ | สิ่งที่ทำ | ผลที่ได้ |
|---|---|---|
| 1–2 สัปดาห์ | Golden dataset + snapshot/restore | ลดเวลา reset ข้อมูลทันที |
| 1–2 เดือน | Seeder script พร้อม scenario template | สร้างข้อมูลใหม่ได้ในไม่กี่นาที |
| ต่อเนื่อง | Stub สำหรับระบบรอบข้าง, catalog/reservation | ลดการพึ่งพาระบบจริงและการชนกันของทีม |

## สิ่งที่ควรเช็กก่อนเริ่ม
* แต่ละระบบมี API, batch import หรือทำได้แค่ผ่าน DB/หน้าจอ ซึ่งกำหนดว่า seeder จะทำได้ลึกแค่ไหน
* ข้อมูลที่ต้อง sync ผูกกันด้วย key อะไร และระบบไหนเป็นต้นทางที่สร้าง key
* ระบบไหนมี batch รายวันหรือ EOD(End-of-Day) ที่เปลี่ยนสถานะข้อมูล เพราะมักเป็นตัวทำให้ข้อมูลหลุด sync