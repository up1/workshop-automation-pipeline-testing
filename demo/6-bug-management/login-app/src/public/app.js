const $ = (sel) => document.querySelector(sel);
const loginView = $('[data-testid="login-view"]');
const welcomeView = $('[data-testid="welcome-view"]');
const form = $('[data-testid="login-form"]');
const errorEl = $('[data-testid="error-message"]');
const submit = $('[data-testid="login-button"]');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function showWelcome(user) {
  $('[data-testid="welcome-message"]').textContent = `Welcome, ${user.displayName}`;
  loginView.hidden = true;
  welcomeView.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;

  const username = $('[data-testid="username-input"]').value.trim();
  const password = $('[data-testid="password-input"]').value;
  if (!username || !password) {
    showError('Username and password are required');
    return;
  }

  submit.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(body.message || 'Login failed');
      return;
    }
    sessionStorage.setItem('token', body.token);
    showWelcome(body.user);
  } catch {
    showError('Cannot reach server. Please try again.');
  } finally {
    submit.disabled = false;
  }
});

$('[data-testid="logout-button"]').addEventListener('click', async () => {
  const token = sessionStorage.getItem('token');
  if (token) await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  sessionStorage.removeItem('token');
  form.reset();
  welcomeView.hidden = true;
  loginView.hidden = false;
});
