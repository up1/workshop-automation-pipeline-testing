import { test, expect } from '../support/fixtures';
import { users } from '../support/users';

/**
 * UI test แบบ mock API ด้วย page.route — ไม่พึ่ง backend จริง ผลนิ่ง เร็ว
 * เหมาะกับ scenario ที่ทำซ้ำยากกับของจริง (500, network error, response ช้า)
 *
 * หมายเหตุ: ลงทะเบียน route ใน test body หลัง loginPage.goto() ได้ เพราะ request จะถูกยิงตอนกดปุ่ม login เท่านั้น
 */
const LOGIN_URL = '**/api/login';

test.describe('Login UI (mock API)', () => {
  test('login สำเร็จ แสดง welcome และส่ง request body ถูกต้อง', async ({ page, loginPage }) => {
    let requestBody: unknown;
    await page.route(LOGIN_URL, async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: { token: 'mock-token', user: { id: 1, username: 'admin', displayName: 'Mock Admin' } },
      });
    });

    await loginPage.login(users.admin.username, users.admin.password);

    await loginPage.expectLoggedIn('Mock Admin');
    expect(requestBody).toEqual({ username: users.admin.username, password: users.admin.password });
    expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('mock-token');
  });

  test('401 แสดงข้อความ invalid credentials', async ({ page, loginPage }) => {
    await page.route(LOGIN_URL, (route) =>
      route.fulfill({ status: 401, json: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } })
    );

    await loginPage.login('admin', 'wrong');

    await loginPage.expectError('Invalid username or password');
    await expect(loginPage.title).toBeVisible();
  });

  test('403 แสดงข้อความ account locked', async ({ page, loginPage }) => {
    await page.route(LOGIN_URL, (route) =>
      route.fulfill({ status: 403, json: { code: 'ACCOUNT_LOCKED', message: 'Account is locked' } })
    );

    await loginPage.login(users.locked.username, users.locked.password);

    await loginPage.expectError('Account is locked');
  });

  test('500 ที่ไม่มี body ใช้ข้อความ fallback', async ({ page, loginPage }) => {
    await page.route(LOGIN_URL, (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));

    await loginPage.login('admin', 'whatever');

    await loginPage.expectError('Login failed');
  });

  test('network error แสดงข้อความ cannot reach server', async ({ page, loginPage }) => {
    await page.route(LOGIN_URL, (route) => route.abort('connectionrefused'));

    await loginPage.login('admin', 'whatever');

    await loginPage.expectError('Cannot reach server. Please try again.');
    await expect(loginPage.loginButton).toBeEnabled();
  });

  test('ปุ่ม login ถูก disable ระหว่างรอ response แล้วกลับมาใช้ได้', async ({ page, loginPage }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(LOGIN_URL, async (route) => {
      await gate;
      await route.fulfill({ status: 401, json: { message: 'Invalid username or password' } });
    });

    await loginPage.login('admin', 'wrong');
    await expect(loginPage.loginButton).toBeDisabled();

    release();
    await loginPage.expectError('Invalid username or password');
    await expect(loginPage.loginButton).toBeEnabled();
  });

  test('กรอกไม่ครบ ไม่ยิง API และแสดง validation message', async ({ page, loginPage }) => {
    let called = false;
    await page.route(LOGIN_URL, async (route) => {
      called = true;
      await route.abort();
    });

    await loginPage.login('admin', '');

    await loginPage.expectError('Username and password are required');
    expect(called).toBe(false);
  });
});
