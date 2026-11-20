const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGODB_URI ||= "mongodb://localhost:27017/equipment-rental-test";
process.env.JWT_SECRET ||= "b".repeat(32);
process.env.STRIPE_CURRENCY = "usd";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.STRIPE_SECRET_KEY;

const app = require("../src/app");

test("public config returns only client-safe settings", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://localhost:${server.address().port}/api/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    currency: "usd",
    googleSignInEnabled: false,
    paymentsEnabled: false,
  });
});
