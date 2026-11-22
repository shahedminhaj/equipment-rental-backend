const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGODB_URI ||= "mongodb://localhost:27017/equipment-rental-test";
process.env.JWT_SECRET ||= "a".repeat(32);
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;

const app = require("../src/app");

test("the API root returns service information", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://localhost:${server.address().port}/`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "equipment-rental-api",
    status: "ok",
    health: "/api/health",
  });
});

test("first-admin setup is unavailable when server credentials are not configured", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://localhost:${server.address().port}/api/auth/admin`;

  const statusResponse = await fetch(`${baseUrl}/setup-status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { configured: false, available: false });

  const setupResponse = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "NotARealSecret1" }),
  });
  assert.equal(setupResponse.status, 503);
  assert.deepEqual(await setupResponse.json(), { message: "Admin setup is not configured" });
});

test("featured review endpoint reports unavailable database instead of serving fake testimonials", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://localhost:${server.address().port}/api/reviews/featured`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Review service is unavailable" });
});


test("notification inbox, read receipts, and sending require authentication", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = `http://localhost:${server.address().port}/api/notifications`;

  const inbox = await fetch(`${endpoint}/mine`);
  assert.equal(inbox.status, 401);
  const readAll = await fetch(`${endpoint}/read-all`, { method: "PATCH" });
  assert.equal(readAll.status, 401);
  const send = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Help", message: "Please contact me" }),
  });
  assert.equal(send.status, 401);
});
