const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeCustomer, makeOrder } = require('./helpers');

let ctx;
beforeEach(async () => { ctx = await setup(); });   // DB ใหม่ทุก test
afterEach(async () => { await ctx.close(); });

test('search_orders_by_customer: คืนเฉพาะ order ของลูกค้าคนนั้น', async () => {
  // Arrange: สร้างข้อมูลเอง (รวมข้อมูล "รบกวน" ของลูกค้าคนอื่น)
  const alice = makeCustomer(ctx.db, { name: 'Alice' });
  const bob = makeCustomer(ctx.db, { name: 'Bob' });
  const o1 = makeOrder(ctx.db, { customerId: alice.id, total: 100 });
  const o2 = makeOrder(ctx.db, { customerId: alice.id, total: 250 });
  makeOrder(ctx.db, { customerId: bob.id, total: 999 });

  // Act: เรียก REST API จริง
  const res = await fetch(`${ctx.baseUrl}/orders?customerId=${alice.id}`);
  const body = await res.json();

  // Assert: ตรวจ "กฎ" ไม่ผูกกับค่าตายตัวของ DB
  assert.equal(res.status, 200);
  assert.deepEqual(body.map((o) => o.id), [o1.id, o2.id]);
  assert.ok(body.every((o) => o.customerId === alice.id));
  assert.equal(body.reduce((s, o) => s + o.total, 0), 350);
  // contract: รูปแบบ field ต้องคงที่
  for (const o of body) {
    assert.deepEqual(Object.keys(o).sort(), ['createdAt', 'customerId', 'id', 'total']);
  }
});

test('search_orders_by_customer: ลูกค้าไม่มี order -> array ว่าง', async () => {
  const carol = makeCustomer(ctx.db);

  const res = await fetch(`${ctx.baseUrl}/orders?customerId=${carol.id}`);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('search_orders_by_customer: ไม่ส่ง customerId -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/orders`);

  assert.equal(res.status, 400);
});
