const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGODB_URI ||= "mongodb://localhost:27017/equipment-rental-test";
process.env.JWT_SECRET ||= "c".repeat(32);

const { SAMPLE_EQUIPMENT, DEMO_OWNER_EMAIL } = require("../src/seed");

test("the demo catalog covers every requested category", () => {
  const categories = new Set(SAMPLE_EQUIPMENT.map((item) => item.category));
  assert.deepEqual(
    [...categories].sort(),
    [
      "Agriculture Equipment",
      "Construction Equipment",
      "Electronics",
      "Event Equipment",
      "Photography Equipment",
      "Vehicles & Transportation",
    ],
  );
});

test("demo listings are bookable with complete approved-listing fields", () => {
  assert.ok(SAMPLE_EQUIPMENT.length >= 12);
  assert.match(DEMO_OWNER_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  for (const item of SAMPLE_EQUIPMENT) {
    assert.ok(item.name && item.description && item.image);
    assert.ok(["Daily", "Weekly", "Monthly"].includes(item.rentalType));
    assert.ok(Number.isSafeInteger(item.price) && item.price > 0);
    assert.ok(Number.isSafeInteger(item.availableQuantity) && item.availableQuantity > 0);
    assert.ok(Array.isArray(item.rentalTerms) && item.rentalTerms.length > 0);
  }
});
