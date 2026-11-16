import { test, expect } from '../support/fixtures';
import { users } from '../support/users';
import { LoginPage } from '../pages/LoginPage';

/**
 * UI test แบบ HAR — 1 scenario = 1 ไฟล์ HAR (tests/har/<scenario>.har)
 *  - ปกติ (replay): ตอบจากไฟล์ HAR โดยไม่แตะ backend จริง, notFound:'abort' = request ที่ไม่มีใน HAR จะ fail
 *  - UPDATE_HAR=1 (record): ยิงไป backend จริงแล้วบันทึกทับไฟล์ HAR   →   npm run har:record
 *
 * ทำไมแยกไฟล์: Playwright เขียน HAR ทับทั้งไฟล์ทุกครั้งที่ context ปิด (1 test = 1 context)
 * ถ้าใช้ไฟล์เดียวร่วมกัน scenario สุดท้ายจะทับของคนอื่นหมด
 *
 * ควรบันทึกใหม่เมื่อ API เปลี่ยน และใช้ Contract/API test ยืนยันว่า HAR ยังตรงกับของจริง
 */
const recording = process.env.UPDATE_HAR === '1';
const harPath = (name: string) => `tests/har/${name}.har`;

async function useHar(page: import('@playwright/test').Page, name: string) {
  await page.routeFromHAR(harPath(name), {
    url: '**/api/login',
    update: recording,
    updateContent: 'embed',
    notFound: 'abort',
  });
}

const scenarios = [
  { name: 'admin-success', user: users.admin.username, pass: users.admin.password, expect: { welcome: users.admin.displayName } },
  { name: 'somchai-success', user: users.somchai.username, pass: users.somchai.password, expect: { welcome: users.somchai.displayName } },
  { name: 'wrong-password', user: users.admin.username, pass: 'wrong-password', expect: { error: 'Invalid username or password' } },
  { name: 'account-locked', user: users.locked.username, pass: users.locked.password, expect: { error: 'Account is locked' } },
] as const;

test.describe(`Login UI (HAR ${recording ? 'RECORD' : 'replay'})`, () => {
  for (const s of scenarios) {
    test(s.name, async ({ page }) => {
      await useHar(page, s.name);
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.login(s.user, s.pass);

      if ('welcome' in s.expect) await loginPage.expectLoggedIn(s.expect.welcome);
      else await loginPage.expectError(s.expect.error);
    });
  }

  test('request ที่ไม่มีใน HAR ถูก abort — ไม่หลุดไป backend จริง', async ({ page }) => {
    test.skip(recording, 'ข้ามตอน record เพราะจะไปทับไฟล์ HAR');
    await useHar(page, 'admin-success');
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    // body ต่างจากที่บันทึกไว้ → ไม่ match HAR
    await loginPage.login('not-in-har', 'x');

    await loginPage.expectError('Cannot reach server. Please try again.');
  });
});
