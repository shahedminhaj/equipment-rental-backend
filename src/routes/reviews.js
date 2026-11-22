const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, parseObjectId, verifyRenter } = require("../middleware");

const router = Router();

function toFeaturedReview(review) {
  return {
    id: String(review._id),
    name: review.customerName || "Verified renter",
    role: "Verified renter",
    quote: review.quote,
    rating: review.rating,
  };
}

router.get("/featured", asyncHandler(async (_request, response) => {
  let db;
  try {
    db = getDatabase();
  } catch {
    return response.status(503).json({ message: "Review service is unavailable" });
  }
  const reviews = await db.collection("reviews")
    .find({ seed: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(8)
    .toArray();
  response.json({ items: reviews.map(toFeaturedReview) });
}));

router.get("/mine", verifyRenter, asyncHandler(async (request, response) => {
  const items = await getDatabase().collection("reviews")
    .find({ customerId: request.user._id })
    .sort({ createdAt: -1 })
    .toArray();
  response.json({
    items: items.map((item) => ({
      id: String(item._id),
      bookingId: String(item.bookingId),
      rating: item.rating,
      quote: item.quote,
      createdAt: item.createdAt,
    })),
  });
}));

router.post("/", verifyRenter, asyncHandler(async (request, response) => {
  const bookingId = parseObjectId(request.body?.bookingId, "booking id");
  const rating = Number(request.body?.rating);
  const quote = typeof request.body?.quote === "string" ? request.body.quote.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || quote.length < 10 || quote.length > 1000) {
    return response.status(400).json({ message: "A 1–5 rating and a review of 10–1000 characters are required" });
  }

  const db = getDatabase();
  const booking = await db.collection("bookings").findOne({
    _id: bookingId,
    customerId: request.user._id,
    bookingStatus: "completed",
    paymentStatus: "paid",
  });
  if (!booking) {
    return response.status(403).json({ message: "Only completed rentals can be reviewed" });
  }

  const reviews = db.collection("reviews");
  if (await reviews.findOne({ bookingId })) {
    return response.status(409).json({ message: "This rental already has a review" });
  }
  const result = await reviews.insertOne({
    bookingId,
    customerId: request.user._id,
    customerName: request.user.name,
    equipmentId: booking.equipmentId,
    rating,
    quote,
    createdAt: new Date(),
  });
  return response.status(201).json({ reviewId: String(result.insertedId) });
}));

module.exports = router;
