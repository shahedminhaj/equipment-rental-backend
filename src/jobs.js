const { getDatabase } = require("./db");

const DAY_IN_MS = 86_400_000;

async function completeExpiredBookings() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await getDatabase().collection("bookings").updateMany(
    {
      rentalEndDate: { $lt: today },
      paymentStatus: "paid",
      bookingStatus: { $in: ["pending", "confirmed"] },
    },
    { $set: { bookingStatus: "completed", updatedAt: new Date() } },
  );
  return result.modifiedCount;
}

function startStatusJobs() {
  const timer = setInterval(() => {
    completeExpiredBookings().catch((error) => {
      console.error("Could not update expired bookings:", error.message);
    });
  }, DAY_IN_MS);
  timer.unref();

  // Run once shortly after boot so a restart also catches expired rentals.
  setTimeout(() => {
    completeExpiredBookings().catch(() => {});
  }, 10_000).unref();

  return timer;
}

module.exports = { completeExpiredBookings, startStatusJobs };
