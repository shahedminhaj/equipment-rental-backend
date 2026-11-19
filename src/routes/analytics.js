const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, verifyAdmin, verifyOwner } = require("../middleware");

const router = Router();

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKeys(count = 12) {
  const first = monthStart(new Date());
  return Array.from({ length: count }, (_value, index) => {
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - count + index + 1, 1));
    return date.toISOString().slice(0, 7);
  });
}

function toMonthlySeries(rows, valueKey) {
  const values = new Map(rows.map((row) => [row.month, row[valueKey]]));
  return monthKeys().map((month) => ({ month, [valueKey]: values.get(month) || 0 }));
}

router.get("/admin", verifyAdmin, asyncHandler(async (_request, response) => {
  const db = getDatabase();
  const [totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals, revenue, monthlyRows] =
    await Promise.all([
      db.collection("users").countDocuments({ disabled: { $ne: true } }),
      db.collection("equipment").countDocuments(),
      db.collection("bookings").countDocuments(),
      db.collection("equipment").countDocuments({ status: "pending" }),
      db.collection("bookings").countDocuments({ bookingStatus: "completed" }),
      db.collection("bookings").aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]).toArray(),
      db.collection("bookings").aggregate([
        { $match: { paymentStatus: "paid", createdAt: { $gte: monthStart(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1))) } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
          bookings: { $sum: 1 },
          revenue: { $sum: "$totalAmount" },
        } },
        { $project: { _id: 0, month: "$_id", bookings: 1, revenue: 1 } },
      ]).toArray(),
    ]);

  response.json({
    totalUsers,
    totalEquipment,
    totalBookings,
    pendingApprovals,
    completedRentals,
    totalRevenue: revenue[0]?.total || 0,
    currency: (await db.collection("bookings").findOne({}, { projection: { currency: 1 } }))?.currency || "bdt",
    monthlyBookings: toMonthlySeries(monthlyRows, "bookings"),
    monthlyRevenue: toMonthlySeries(monthlyRows, "revenue"),
  });
}));

router.get("/owner", verifyOwner, asyncHandler(async (request, response) => {
  const db = getDatabase();
  const ownerId = request.user._id;
  const [totalListedEquipment, completedRentals, earnings, monthlyRows] = await Promise.all([
    db.collection("equipment").countDocuments({ ownerId }),
    db.collection("bookings").countDocuments({ ownerId, bookingStatus: "completed" }),
    db.collection("bookings").aggregate([
      { $match: { ownerId, paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]).toArray(),
    db.collection("bookings").aggregate([
      {
        $match: {
          ownerId,
          paymentStatus: "paid",
          createdAt: {
            $gte: monthStart(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1))),
          },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
          earnings: { $sum: "$totalAmount" },
        },
      },
      { $project: { _id: 0, month: "$_id", earnings: 1 } },
    ]).toArray(),
  ]);
  response.json({
    totalListedEquipment,
    completedRentals,
    totalEarnings: earnings[0]?.total || 0,
    monthlyEarnings: toMonthlySeries(monthlyRows, "earnings"),
  });
}));

module.exports = router;
