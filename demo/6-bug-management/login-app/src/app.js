import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, verifyPassword } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db = openDb(process.env.DB_PATH || ':memory:')) {
  const app = express();
  app.use(express.json());

  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const createSession = db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)');
  const findSession = db.prepare(
    `SELECT u.id, u.username, u.display_name FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // POST /api/login
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'username and password are required',
      });
    }

    const user = findUser.get(username.trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
    }
    if (user.is_locked) {
      return res.status(403).json({ code: 'ACCOUNT_LOCKED', message: 'Account is locked' });
    }

    const token = randomUUID();
    createSession.run(token, user.id);
    return res.status(200).json({
      token,
      user: { id: user.id, username: user.username, displayName: user.display_name },
    });
  });

  const requireAuth = (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = token && findSession.get(token);
    if (!user) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing or invalid token' });
    req.user = user;
    req.token = token;
    next();
  };

  app.get('/api/me', requireAuth, (req, res) =>
    res.json({ id: req.user.id, username: req.user.username, displayName: req.user.display_name })
  );

  app.post('/api/logout', requireAuth, (req, res) => {
    deleteSession.run(req.token);
    res.status(204).end();
  });

  app.use(express.static(join(__dirname, 'public')));
  return app;
}
