import { expect, type Locator, type Page } from '@playwright/test';

/** Page Object ของหน้า Login — locator ทั้งหมดใช้ data-testid */
export class LoginPage {
  readonly title: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly welcomeMessage: Locator;
  readonly logoutButton: Locator;

  constructor(readonly page: Page) {
    this.title = page.getByTestId('login-title');
    this.usernameInput = page.getByTestId('username-input');
    this.passwordInput = page.getByTestId('password-input');
    this.loginButton = page.getByTestId('login-button');
    this.errorMessage = page.getByTestId('error-message');
    this.welcomeMessage = page.getByTestId('welcome-message');
    this.logoutButton = page.getByTestId('logout-button');
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.title).toBeVisible();
  }

  async fillCredentials(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.loginButton.click();
  }

  async login(username: string, password: string) {
    await this.fillCredentials(username, password);
    await this.submit();
  }

  /** กด login แล้วรอ response ของ POST /api/login เพื่อให้ assert status ได้ */
  async loginAndWaitForApi(username: string, password: string) {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().endsWith('/api/login') && r.request().method() === 'POST'),
      this.login(username, password),
    ]);
    return response;
  }

  async expectLoggedIn(displayName: string) {
    await expect(this.welcomeMessage).toHaveText(`Welcome, ${displayName}`);
    await expect(this.title).toBeHidden();
  }

  async expectError(message: string | RegExp) {
    await expect(this.errorMessage).toBeVisible();
    await expect(this.errorMessage).toHaveText(message);
  }

  async expectNoError() {
    await expect(this.errorMessage).toBeHidden();
  }
}
