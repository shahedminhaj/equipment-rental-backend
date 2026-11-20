const test = require("node:test");
const assert = require("node:assert/strict");
const dotenv = require("dotenv");

test("quoted admin passwords keep # characters when dotenv loads .env", () => {
  const parsed = dotenv.parse('ADMIN_EMAIL="admin@example.com"\nADMIN_PASSWORD="XYXm12##"');

  assert.equal(parsed.ADMIN_EMAIL, "admin@example.com");
  assert.equal(parsed.ADMIN_PASSWORD, "XYXm12##");
});

test("unquoted # starts a comment, so the env example documents quoting", () => {
  const parsed = dotenv.parse("ADMIN_PASSWORD=XYXm12##");

  assert.equal(parsed.ADMIN_PASSWORD, "XYXm12");
});
