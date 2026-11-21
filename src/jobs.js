const cron = require("node-cron");
const { getDatabase } = require("./db");

async function completeExpiredBookings(database = getDatabase()) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await database.collection("bookings").updateMany(
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
  const task = cron.schedule("0 1 * * *", () => {
    completeExpiredBookings().catch((error) => {
      console.error("Could not update expired bookings:", error.message);
    });
  });

  // Run once shortly after boot so a restart also catches expired rentals.
  setTimeout(() => {
    completeExpiredBookings().catch(() => {});
  }, 10_000).unref();

  return task;
}

module.exports = { completeExpiredBookings, startStatusJobs };
