import { test, expect } from '../support/fixtures';
import { users } from '../support/users';

/** UI test กับ API จริง (end-to-end) — ใช้เป็นชุดเล็กๆ ของ critical flow */
test.describe('Login UI (real API)', () => {
  test('login สำเร็จด้วย admin และได้ 200', async ({ page, loginPage }) => {
    const response = await loginPage.loginAndWaitForApi(users.admin.username, users.admin.password);

    expect(response.status()).toBe(200);
    await loginPage.expectLoggedIn(users.admin.displayName);
    expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBeTruthy();
  });

  test('login สำเร็จด้วย user อื่น', async ({ loginPage }) => {
    await loginPage.login(users.somchai.username, users.somchai.password);
    await loginPage.expectLoggedIn(users.somchai.displayName);
  });

  test('รหัสผ่านผิด ได้ 401 และแสดง error', async ({ loginPage }) => {
    const response = await loginPage.loginAndWaitForApi(users.admin.username, 'wrong-password');

    expect(response.status()).toBe(401);
    await loginPage.expectError('Invalid username or password');
    await expect(loginPage.title).toBeVisible();
  });

  test('user ที่ถูก lock ได้ 403', async ({ loginPage }) => {
    const response = await loginPage.loginAndWaitForApi(users.locked.username, users.locked.password);

    expect(response.status()).toBe(403);
    await loginPage.expectError('Account is locked');
  });

  test('กรอก username ว่าง แสดง validation ฝั่ง client', async ({ loginPage }) => {
    await loginPage.login('', users.admin.password);
    await loginPage.expectError('Username and password are required');
  });

  test('error หายไปเมื่อ login สำเร็จในครั้งถัดไป', async ({ loginPage }) => {
    await loginPage.login(users.admin.username, 'wrong');
    await loginPage.expectError('Invalid username or password');

    await loginPage.login(users.admin.username, users.admin.password);
    await loginPage.expectLoggedIn(users.admin.displayName);
  });

  test('logout กลับมาหน้า login และล้าง token', async ({ page, loginPage }) => {
    await loginPage.login(users.admin.username, users.admin.password);
    await loginPage.expectLoggedIn(users.admin.displayName);

    await loginPage.logoutButton.click();

    await expect(loginPage.title).toBeVisible();
    await expect(loginPage.usernameInput).toHaveValue('');
    expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBeNull();
  });

  test('กด Enter ที่ช่อง password เพื่อ submit ได้', async ({ loginPage }) => {
    await loginPage.fillCredentials(users.admin.username, users.admin.password);
    await loginPage.passwordInput.press('Enter');
    await loginPage.expectLoggedIn(users.admin.displayName);
  });
});
