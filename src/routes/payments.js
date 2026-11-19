const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, verifyAdmin, verifyRenter } = require("../middleware");
const { toPublicDocument } = require("../domain");

const router = Router();

router.get("/mine", verifyRenter, asyncHandler(async (request, response) => {
  const bookings = await getDatabase().collection("bookings")
    .find({ customerId: request.user._id }, { projection: { _id: 1 } })
    .toArray();
  const payments = bookings.length
    ? await getDatabase().collection("payments")
      .find({ bookingId: { $in: bookings.map((booking) => booking._id) } })
      .sort({ createdAt: -1 })
      .toArray()
    : [];
  response.json({ items: payments.map(toPublicDocument) });
}));

router.get("/admin", verifyAdmin, asyncHandler(async (_request, response) => {
  const payments = await getDatabase().collection("payments")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ items: payments.map(toPublicDocument) });
}));

module.exports = router;
