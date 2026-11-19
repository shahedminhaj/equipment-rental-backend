const test = require("node:test");
const assert = require("node:assert/strict");
const {
  equipmentFilter,
  equipmentSort,
  pagination,
  rentalUnits,
  toPublicDocument,
} = require("../src/domain");

test("rental pricing units use calendar-day duration and round up longer periods", () => {
  assert.equal(rentalUnits("2026-12-01", "2026-12-01", "Daily"), 1);
  assert.equal(rentalUnits("2026-12-01", "2026-12-08", "Weekly"), 1);
  assert.equal(rentalUnits("2026-12-01", "2026-12-09", "Weekly"), 2);
  assert.equal(rentalUnits("2026-12-01", "2026-12-31", "Monthly"), 1);
});

test("rental duration rejects invalid dates, reversed dates, and unknown rate types", () => {
  for (const [start, end, type] of [
    ["2026-02-30", "2026-03-01", "Daily"],
    ["2026-12-02", "2026-12-01", "Daily"],
    ["2026-12-01", "2026-12-02", "Hourly"],
  ]) {
    assert.throws(() => rentalUnits(start, end, type), { status: 400 });
  }
});

test("equipment query matches public fields and validates range and sorting", () => {
  const filter = equipmentFilter({
    search: "drone.*",
    category: "Photography",
    rentalType: "Daily",
    minPrice: "100",
    maxPrice: "5000",
    available: "true",
  });
  assert.equal(filter.status, "approved");
  assert.deepEqual(filter.$or[0].name, /drone\.\*/i);
  assert.equal(filter.category, "Photography");
  assert.equal(filter.rentalType, "Daily");
  assert.deepEqual(filter.price, { $gte: 100, $lte: 5000 });
  assert.deepEqual(filter.availableQuantity, { $gt: 0 });
  assert.deepEqual(equipmentSort("price-low"), { price: 1, _id: 1 });
  assert.throws(() => equipmentFilter({ minPrice: "bad" }), { status: 400 });
  assert.throws(() => equipmentFilter({ available: "sometimes" }), { status: 400 });
  assert.throws(() => equipmentSort("random"), { status: 400 });
});

test("pagination is bounded and public serialization omits password hashes", () => {
  assert.deepEqual(pagination({ page: "3", limit: "500" }), {
    page: 3,
    limit: 100,
    skip: 200,
  });
  assert.deepEqual(toPublicDocument({
    _id: { toString: () => "abc123" },
    passwordHash: "secret",
    name: "Renter",
  }), { id: "abc123", name: "Renter" });
});
