# Bug management


## Root cause analysis
```
ไม่มี "ความจริงชุดเดียว" ที่ผูกทุกอย่างเข้าด้วยกันด้วย Build / Run ID ถ้าแก้ตรงนี้ก่อน ปัญหาที่เหลือจะจัดการง่ายขึ้นมาก
```

## Start with standard ให้ทุกระบบ sync กันผ่าน ID เดียว
* Pipeline ใน CI/CD => Build ID / Run ID
* ส่งค่าไปยังส่วนต่าง ๆ เช่น test report, log, screenshot, test data และ Jira ticket
* ผูก Test Case กับ Jira ด้วย Key (เช่น `tag @PROJ-123`) แล้วให้ Pipeline อัปโหลดผลเข้า Test Management Tool (Xray, Zephyr, TestRail) อัตโนมัติ
* ให้ Pipeline เป็นตัวสร้าง `Release Quality Status` จากข้อมูลจริง (pass rate, coverage, defect ที่ยังเปิดอยู่) แทนการรวบรวมเอง


## Solution :: วิเคราะห์สาเหตุ Failure ให้เร็วขึ้น
1. เก็บหลักฐานอัตโนมัติทุกครั้งที่ fail: screenshot, video, trace (Playwright Trace Viewer), console log, network/HAR, response ของ API และ server log ที่ใช้ `correlation ID` เดียวกัน

2. Pre-flight / health check ก่อนรัน: เช็กว่า environment, DB, service ที่ต้องใช้งาน และ test data พร้อมหรือไม่ 
   * ถ้าไม่พร้อมให้หยุดและแจ้งว่า “Environment Issue” แทนที่จะรันแล้ว fail เป็นร้อยเคส
3. จัดหมวด Failure อัตโนมัติ เริ่มจาก rule-based แล้วค่อยเพิ่ม AI ช่วย เช่น

| ลักษณะ error | หมวดที่น่าจะเป็น |
|---|---|
| Element not found / timeout บน locator | Test Script |
| 5xx, connection refused, DNS | Environment |
| Data not found / duplicate key | Test Data |
| Assertion fail บน business logic แต่ script ปกติ | Application Defect |
| Third-party timeout | External Service |

4. Flaky detection: retry 1-2 ครั้ง ถ้าผ่านใส่ tag “flaky” แล้วแยกไปติดตามต่างหาก ไม่ให้รวมกับ failure จริง

## Solution :: รวมข้อมูลกระจัดกระจายไว้ที่เดียว
1. ใช้ U`nified Dashboard` (ReportPortal / Allure TestOps หรือ Grafana + ELK) ที่ดึงข้อมูลจาก CI/CD, log และ Jira มาไว้หน้าเดียว
2. ใน report แต่ละ failure ควรมี link ตรงไปยัง build, log, commit ที่เปลี่ยน และ Jira ที่เกี่ยวข้อง

## Solution :: ลดภาระ Maintenance เมื่อ UI เปลี่ยนบ่อย
1. ตกลงกับ Dev ให้ใส่ `data-testid` (หรือ attribute ที่คงที่) บน element สำคัญ แล้วเลิกใช้ XPath ยาวๆ หรือ CSS ที่ผูกกับ layout วิธีนี้ได้ผลสูงสุดต่อต้นทุนต่ำสุด
2. ใช้ Page Object / Component Object Model เพื่อให้แก้ locator ที่เดียวแล้วมีผลทุก test
3. ย้าย test จาก UI ลงมา API/Component level ให้มากที่สุด ตาม Test Pyramid เหลือ UI E2E เฉพาะ critical flow
4. พิจารณา Self-healing แต่ควรให้ระบบ "เสนอ" การแก้ แล้วคนรีวิว ไม่ใช่แก้เงียบๆ เพราะอาจซ่อน defect จริง
5. ผูก PR กับ test ที่ได้รับผลกระทบ ให้ Dev แจ้ง/แก้ script พร้อม PR (Definition of Done รวม automation) และรัน test แบบ impact-based เพื่อ feedback เร็ว

## Solution :: จัดการ Test Data
1. Test Data as Code: สร้างด้วย data factory/builder ใน fixture (เรียก API หรือ seed DB) ให้แต่ละ test สร้างข้อมูลของตัวเองและ cleanup เอง ไม่แชร์ข้อมูลกัน
2. สร้างข้อมูลสังเคราะห์ด้วย Faker หรือใช้ ข้อมูลจริงที่ทำ masking แล้ว
3. ทำ DB snapshot หรือ container ที่ reset ได้ (Testcontainers, restore snapshot) ก่อนรันแต่ละรอบ
4. ทำ Test Data Service หรือ API กลาง ให้ทั้งทีมขอข้อมูลตาม scenario ได้ เช่น "ลูกค้าที่มียอดค้างชำระ"
5. Versioning ข้อมูลให้ตรงกับ schema ของ build เพื่อกันปัญหา data ไม่ตรงกับ application

## Solution :: จัดการ External หรือ Third-party Service
1. Service Virtualization / Mock ด้วย WireMock, MockServer, Stubby: เทสต์หลักใน Pipeline ใช้ mock ทั้งหมดเพื่อให้ผลนิ่ง
2. ใช้ Record & Replay บันทึก response จริงมาเล่นซ้ำ แล้วอัปเดตเป็นระยะ
3. ทำ Contract Testing (Pact) ตรวจว่า mock ยังตรงกับ API จริง ไม่เช่นนั้น mock จะเก่าแล้วให้ผลหลอก
4. แยก Pipeline: รอบหลักใช้ mock, ส่วนรอบ Integration จริง (nightly) ใช้ sandbox ของผู้ให้บริการ และมี retry/timeout ที่เหมาะสม โดยติด tag ให้ชัดว่า failure ประเภทนี้ไม่ block release อัตโนมัติ
5. ทดสอบ fault injection (timeout, 500, response ช้า) ด้วย mock เพื่อดู error handling ซึ่งทำกับระบบจริงไม่ได้