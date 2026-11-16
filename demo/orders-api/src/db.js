const { DatabaseSync } = require('node:sqlite');

// path = ':memory:' สำหรับ test, ไฟล์จริงสำหรับ production
function createDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      total       REAL NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { createDb };
