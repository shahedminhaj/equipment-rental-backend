const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, verifyAdmin, verifyOwner } = require("../middleware");
const config = require("../config");

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

function paidBookingRevenuePipeline({ ownerId, since, includeMonthly = false } = {}) {
  const match = { status: "paid" };
  if (since) match.createdAt = { $gte: since };
  return [
    { $match: match },
    { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "booking" } },
    { $unwind: "$booking" },
    ...(ownerId ? [{ $match: { "booking.ownerId": ownerId } }] : []),
    { $group: {
      _id: null,
      total: { $sum: "$booking.totalAmount" },
      ...(includeMonthly ? {
        monthly: { $push: { month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } }, amount: "$booking.totalAmount" } },
      } : {}),
    } },
  ];
}

router.get("/admin", verifyAdmin, asyncHandler(async (_request, response) => {
  const db = getDatabase();
  const since = monthStart(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)));
  const [totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals, paidRevenue, monthlyRevenue, bookingRows] =
    await Promise.all([
      db.collection("users").countDocuments({ disabled: { $ne: true } }),
      db.collection("equipment").countDocuments(),
      db.collection("bookings").countDocuments({ bookingStatus: { $nin: ["cancelled", "rejected"] } }),
      db.collection("equipment").countDocuments({ status: "pending" }),
      db.collection("bookings").countDocuments({ bookingStatus: "completed" }),
      db.collection("payments").aggregate(paidBookingRevenuePipeline()).toArray(),
      db.collection("payments").aggregate(paidBookingRevenuePipeline({ since, includeMonthly: true })).toArray(),
      db.collection("bookings").aggregate([
        { $match: { bookingStatus: { $nin: ["cancelled", "rejected"] }, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } }, bookings: { $sum: 1 } } },
        { $project: { _id: 0, month: "$_id", bookings: 1 } },
      ]).toArray(),
    ]);
  const paidRevenueRows = monthlyRevenue[0]?.monthly || [];
  const revenueByMonth = new Map();
  for (const row of paidRevenueRows) revenueByMonth.set(row.month, (revenueByMonth.get(row.month) || 0) + row.amount);
  const monthlyRevenueRows = [...revenueByMonth].map(([month, revenue]) => ({ month, revenue }));
  response.json({
    totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals,
    totalRevenue: paidRevenue[0]?.total || 0,
    currency: config.stripeCurrency,
    monthlyBookings: toMonthlySeries(bookingRows, "bookings"),
    monthlyRevenue: toMonthlySeries(monthlyRevenueRows, "revenue"),
  });
}));

router.get("/owner", verifyOwner, asyncHandler(async (request, response) => {
  const db = getDatabase();
  const ownerId = request.user._id;
  const since = monthStart(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)));
  const [totalListedEquipment, completedRentals, earnings, monthlyEarnings] = await Promise.all([
    db.collection("equipment").countDocuments({ ownerId }),
    db.collection("bookings").countDocuments({ ownerId, bookingStatus: "completed" }),
    db.collection("payments").aggregate(paidBookingRevenuePipeline({ ownerId })).toArray(),
    db.collection("payments").aggregate(paidBookingRevenuePipeline({ ownerId, since, includeMonthly: true })).toArray(),
  ]);
  const monthlyRows = new Map();
  for (const row of monthlyEarnings[0]?.monthly || []) {
    monthlyRows.set(row.month, (monthlyRows.get(row.month) || 0) + row.amount);
  }
  response.json({
    totalListedEquipment,
    completedRentals,
    totalEarnings: earnings[0]?.total || 0,
    monthlyEarnings: toMonthlySeries([...monthlyRows].map(([month, earnings]) => ({ month, earnings })), "earnings"),
  });
}));

module.exports = router;
