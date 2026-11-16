const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

// --- Data builders: test สร้างข้อมูลที่ต้องใช้เอง ---
function makeCustomer(db, { name = 'Test Customer' } = {}) {
  const r = db.prepare('INSERT INTO customers (name) VALUES (?)').run(name);
  return { id: Number(r.lastInsertRowid), name };
}

function makeOrder(db, { customerId, total = 100 }) {
  const r = db
    .prepare('INSERT INTO orders (customer_id, total) VALUES (?, ?)')
    .run(customerId, total);
  return { id: Number(r.lastInsertRowid), customerId, total };
}

// --- สร้าง DB (in-memory ใหม่) + server ที่ port สุ่ม ต่อ 1 test ---
async function setup() {
  const db = createDb(':memory:');
  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { setup, makeCustomer, makeOrder };
