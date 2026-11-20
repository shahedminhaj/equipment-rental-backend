const test = require("node:test");
const assert = require("node:assert/strict");
const { completeExpiredBookings } = require("../src/jobs");

test("expired paid bookings are completed automatically", async () => {
  let capturedFilter;
  let capturedUpdate;
  const database = {
    collection(name) {
      assert.equal(name, "bookings");
      return {
        async updateMany(filter, update) {
          capturedFilter = filter;
          capturedUpdate = update;
          return { modifiedCount: 2 };
        },
      };
    },
  };

  const modified = await completeExpiredBookings(database);
  assert.equal(modified, 2);
  assert.equal(capturedFilter.paymentStatus, "paid");
  assert.deepEqual(capturedFilter.bookingStatus, { $in: ["pending", "confirmed"] });
  assert.match(capturedFilter.rentalEndDate.$lt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(capturedUpdate.$set.bookingStatus, "completed");
});
