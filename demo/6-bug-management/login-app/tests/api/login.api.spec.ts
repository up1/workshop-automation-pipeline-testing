import { test, expect } from '@playwright/test';
import { users } from '../support/users';

test.describe('POST /api/login', () => {
  test('200 — login สำเร็จ คืน token และข้อมูล user', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: users.admin.username, password: users.admin.password },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({
      token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      user: { id: expect.any(Number), username: 'admin', displayName: 'Administrator' },
    });
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });

  test('200 — ตัดช่องว่างหน้า/หลัง username', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: '  admin  ', password: users.admin.password },
    });
    expect(res.status()).toBe(200);
  });

  test('แต่ละครั้งที่ login ได้ token ใหม่', async ({ request }) => {
    const login = async () =>
      (await (await request.post('/api/login', { data: users.admin })).json()).token as string;
    const [a, b] = [await login(), await login()];
    expect(a).not.toBe(b);
  });

  test('401 — รหัสผ่านผิด', async ({ request }) => {
    const res = await request.post('/api/login', { data: { username: 'admin', password: 'wrong' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
  });

  test('401 — ไม่มี user นี้ และข้อความเหมือนรหัสผ่านผิด (ไม่เปิดเผยว่ามี user หรือไม่)', async ({ request }) => {
    const unknown = await request.post('/api/login', { data: { username: 'nobody', password: 'x' } });
    const wrongPw = await request.post('/api/login', { data: { username: 'admin', password: 'x' } });
    expect(unknown.status()).toBe(401);
    expect(await unknown.json()).toEqual(await wrongPw.json());
  });

  test('403 — account ถูก lock', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: users.locked.username, password: users.locked.password },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('ACCOUNT_LOCKED');
  });

  test('401 — user ที่ lock แต่รหัสผ่านผิด ไม่บอกว่า lock', async ({ request }) => {
    const res = await request.post('/api/login', { data: { username: 'locked', password: 'wrong' } });
    expect(res.status()).toBe(401);
  });

  const invalidPayloads: Array<[string, unknown]> = [
    ['ไม่มี body', undefined],
    ['body ว่าง', {}],
    ['ไม่มี password', { username: 'admin' }],
    ['ไม่มี username', { password: 'Password123!' }],
    ['username เป็นช่องว่าง', { username: '   ', password: 'x' }],
    ['password เป็นสตริงว่าง', { username: 'admin', password: '' }],
    ['username ไม่ใช่ string', { username: 123, password: 'x' }],
    ['password เป็น object', { username: 'admin', password: { $ne: '' } }],
  ];
  for (const [name, data] of invalidPayloads) {
    test(`400 — ${name}`, async ({ request }) => {
      const res = await request.post('/api/login', { data: data as never });
      expect(res.status()).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_ERROR');
    });
  }

  test("SQL injection ใน username ต้องได้ 401 ไม่ใช่ 500/200", async ({ request }) => {
    const res = await request.post('/api/login', { data: { username: "admin' OR '1'='1", password: 'x' } });
    expect(res.status()).toBe(401);
  });

  test('GET /api/login ไม่รองรับ', async ({ request }) => {
    const res = await request.get('/api/login');
    expect(res.status()).toBe(404);
  });
});

test.describe('session endpoints', () => {
  async function loginToken(request: import('@playwright/test').APIRequestContext) {
    const res = await request.post('/api/login', { data: users.somchai });
    return (await res.json()).token as string;
  }

  test('GET /api/me ด้วย token ที่ได้จาก login', async ({ request }) => {
    const token = await loginToken(request);
    const res = await request.get('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ username: 'somchai', displayName: 'Somchai Jaidee' });
  });

  test('GET /api/me ไม่มี token หรือ token ผิด → 401', async ({ request }) => {
    expect((await request.get('/api/me')).status()).toBe(401);
    const bad = await request.get('/api/me', { headers: { Authorization: 'Bearer not-a-token' } });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).code).toBe('UNAUTHORIZED');
  });

  test('POST /api/logout ทำให้ token ใช้ไม่ได้อีก', async ({ request }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    expect((await request.post('/api/logout', { headers })).status()).toBe(204);
    expect((await request.get('/api/me', { headers })).status()).toBe(401);
  });

  test('GET /api/health', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
