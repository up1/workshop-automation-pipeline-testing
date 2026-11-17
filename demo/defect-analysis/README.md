# Defect Analysis: จัดกลุ่มสาเหตุ Test Failure ด้วย Agent Skill

Skill `test-failure-triage` อ่านผลทดสอบแบบ JUnit XML แล้วจัดกลุ่ม failure เป็น

| กลุ่ม | ความหมาย |
|---|---|
| Defect | แอปทำงานผิด ส่วน script และ environment ปกติ |
| Script Issue | locator, wait หรือโค้ดเทสผิด |
| Environment Issue | service ล่ม, network, infra ของ runner |
| Test Data Issue | ข้อมูลหาย ซ้ำ หรือเก่า |
| Needs review | ไม่ตรงกฎใด ต้องให้คนตัดสิน |
| Flaky | fail แล้ว retry ผ่าน (ไม่นับเป็น Defect) |

รองรับเฉพาะ JUnit XML

## โครงสร้าง

```
.github/skills/test-failure-triage/
  SKILL.md                          ขั้นตอนและกติกาของ skill
  references/classification-rules.md  ตารางกฎจัดกลุ่ม
  scripts/classify.mjs              ตัวอ่าน JUnit และจัดกลุ่ม (Node ไม่ต้องติดตั้ง package)
  scripts/rules.json                กฎจัดกลุ่ม (regex) แก้ได้โดยไม่ต้องแตะโค้ด
samples/junit-failing.xml           ตัวอย่างที่ fail ครบทุกกลุ่ม
expected-report.md                  ผลลัพธ์ที่คาดหวังจากตัวอย่าง
```

## วิธีใช้

Prompt :: 

```
วิเคราะห์ผลการทดสอบใน samples/junit-failing.xml และจัดกลุ่มสาเหตุที่ fail
```

หรือรันสคริปต์ตรงๆ

```bash
node .github/skills/test-failure-triage/scripts/classify.mjs samples/junit-failing.xml --md report.md --json report.json
```

## ผลที่คาดหวังจาก samples/junit-failing.xml

| Test | กลุ่ม | กฎ |
|---|---|---|
| 403 — บัญชีถูกล็อก (ได้ 200) | Defect | DEFECT-ASSERT |
| show error on wrong password (หา element ไม่เจอ) | Script Issue | SCRIPT-LOCATOR |
| logout button (`logout is not a function`) | Script Issue | SCRIPT-CODE |
| GET /api/me (ECONNREFUSED) | Environment Issue | ENV-NET |
| POST /api/register (UNIQUE constraint) | Test Data Issue | DATA-DUP |
| remember me (ข้อความไม่ตรงกฎ) | Needs review | NONE |
| session refresh (retry แล้วผ่าน) | Flaky | - |

ดูรายละเอียดเต็มใน [expected-report.md](expected-report.md)

## หมายเหตุ

- การจัดกลุ่มด้วยกฎเป็นการประเมินเบื้องต้น เคส confidence ต่ำหรือกลาง AI จะตรวจหลักฐานซ้ำก่อนสรุป
- เพิ่มกฎใหม่ได้ที่ `scripts/rules.json` (ไม่ต้องแก้โค้ด)
