const express = require('express');

// รับ db เข้ามา (dependency injection) เพื่อให้ test ใส่ DB ของตัวเองได้
function createApp(db) {
  const app = express();
  app.use(express.json());

  // GET /orders?customerId=1
  app.get('/orders', (req, res) => {
    const customerId = Number(req.query.customerId);
    if (!Number.isInteger(customerId)) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    const rows = db
      .prepare(
        `SELECT id, customer_id AS customerId, total, created_at AS createdAt
           FROM orders
          WHERE customer_id = ?
          ORDER BY id`
      )
      .all(customerId);
    res.json(rows);
  });

  return app;
}

module.exports = { createApp };
