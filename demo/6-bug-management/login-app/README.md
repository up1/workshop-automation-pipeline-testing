# Login App + Playwright Tests

Express + `node:sqlite` (built-in, ต้อง Node >= 22.13) — หน้า Login และ `POST /api/login`

## เริ่มใช้งาน
```bash
npm install
npx playwright install chromium   # หรือใช้ Chrome ในเครื่อง: PW_CHANNEL=chrome
npm start                         # http://localhost:3000   (DB_PATH=./app.db เพื่อเก็บลงไฟล์)
```

## Users (seed)
| username | password | ผลลัพธ์ |
|---|---|---|
| admin | Password123! | 200 |
| somchai | Secret456! | 200 |
| locked | Locked789! | 403 ACCOUNT_LOCKED |

## API
| Method | Path | ผลลัพธ์ |
|---|---|---|
| POST | /api/login `{username,password}` | 200 `{token,user}` / 400 / 401 / 403 |
| GET | /api/me (Bearer) | 200 / 401 |
| POST | /api/logout (Bearer) | 204 / 401 |
| GET | /api/health | 200 |

## รัน Test (Playwright เปิด server ให้เองที่ port 3100)
```bash
npm test                 # ทั้งหมด
npm run test:ui:mock     # UI + mock (page.route) + HAR replay
npm run test:ui:real     # UI กับ API จริง
npm run test:api         # API test
npm run har:record       # บันทึก HAR ใหม่จาก backend จริง → tests/har/*.har
npm run report           # เปิด HTML report
```
Env: `PW_CHANNEL=chrome` ใช้ Chrome ในเครื่อง, `PW_VIDEO=off` ปิดการอัดวิดีโอ (ถ้าไม่มี ffmpeg), `BASE_URL=...` ชี้ไปยัง environment อื่นโดยไม่เปิด server เอง

## โครงสร้าง test
```
tests/
  pages/LoginPage.ts          Page Object (locator ทั้งหมดใช้ data-testid)
  support/fixtures.ts         fixture loginPage (เปิดหน้า + พร้อมใช้)
  support/users.ts            ข้อมูลทดสอบ
  ui/login.mock.spec.ts       mock ด้วย page.route: 200/401/403/500/network error/loading
  ui/login.har.spec.ts        routeFromHAR (replay; UPDATE_HAR=1 = record), 1 scenario = 1 ไฟล์
  ui/login.real.spec.ts       E2E กับ API จริง
  api/login.api.spec.ts       API test ด้วย request fixture
  har/*.har                   HAR ที่บันทึกไว้
```

## หมายเหตุ
- HAR มี username/password ของ test user — ใช้เฉพาะ test data ห้ามบันทึกจาก environment ที่เป็นข้อมูลจริง
- บันทึก HAR ใหม่เมื่อ API เปลี่ยน และใช้ API test เป็น contract check ว่า mock/HAR ยังตรงกับของจริง
