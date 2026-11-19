const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGODB_URI ||= "mongodb://localhost:27017/equipment-rental-test";
process.env.JWT_SECRET ||= "a".repeat(32);

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
