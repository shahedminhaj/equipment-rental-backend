const { Router } = require("express");
const Stripe = require("stripe");
const config = require("../config");
const { getDatabase } = require("../db");
const { acquireReservationLock, releaseReservationLock } = require("../reservation-lock");
const {
  asyncHandler,
  authenticate,
  parseObjectId,
  verifyAdmin,
  verifyOwner,
  verifyRenter,
} = require("../middleware");
const { BOOKING_STATUSES, rentalUnits, toPublicDocument } = require("../domain");

const router = Router();
let stripeClient;

async function hydrateBookings(bookings) {
  if (!bookings.length) return [];
  const db = getDatabase();
  const userIds = [...new Map(
    bookings.flatMap((booking) => [
      [booking.customerId.toString(), booking.customerId],
      [booking.ownerId.toString(), booking.ownerId],
    ]),
  ).values()];
  const equipmentIds = [...new Map(
    bookings.map((booking) => [booking.equipmentId.toString(), booking.equipmentId]),
  ).values()];
  const [users, equipment] = await Promise.all([
    db.collection("users").find(
      { _id: { $in: userIds } },
      { projection: { name: 1, email: 1, photo: 1, phone: 1, address: 1 } },
    ).toArray(),
    db.collection("equipment").find(
      { _id: { $in: equipmentIds } },
      { projection: { name: 1, category: 1, image: 1, location: 1, _id: 1 } },
    ).toArray(),
  ]);
  const userById = new Map(users.map((user) => [user._id.toString(), toPublicDocument(user)]));
  const equipmentById = new Map(equipment.map((item) => [item._id.toString(), toPublicDocument(item)]));
  return bookings.map((booking) => toPublicDocument({
    ...booking,
    customer: userById.get(booking.customerId.toString()) || null,
    owner: userById.get(booking.ownerId.toString()) || null,
    equipment: equipmentById.get(booking.equipmentId.toString()) || {
      id: booking.equipmentId.toString(),
      name: booking.equipmentName,
    },
  }));
}

function getStripe() {
  if (!config.stripeSecretKey) {
    const error = new Error("Stripe payments are not configured");
    error.status = 503;
    throw error;
  }
  if (!stripeClient) stripeClient = new Stripe(config.stripeSecretKey);
  return stripeClient;
}

async function countReservedQuantity(equipmentId, startDate, endDate) {
  const now = new Date();
  const overlaps = await getDatabase().collection("bookings").find({
    equipmentId,
    rentalStartDate: { $lte: endDate },
    rentalEndDate: { $gte: startDate },
    $or: [
      { paymentStatus: "paid", bookingStatus: { $in: ["pending", "confirmed"] } },
      { paymentStatus: "pending", checkoutExpiresAt: { $gt: now } },
    ],
  }, { projection: { quantity: 1 } }).toArray();
  return overlaps.reduce((total, booking) => total + booking.quantity, 0);
}

router.post("/", verifyRenter, asyncHandler(async (request, response) => {
  const {
    equipmentId: equipmentIdValue,
    rentalStartDate,
    rentalEndDate,
    quantity,
    contactNumber,
    deliveryAddress,
    notes = "",
  } = request.body || {};
  const equipmentId = parseObjectId(equipmentIdValue, "equipment id");
  if (
    !Number.isSafeInteger(quantity) || quantity < 1 ||
    typeof contactNumber !== "string" || contactNumber.trim().length < 7 || contactNumber.length > 30 ||
    typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 5 || deliveryAddress.length > 300 ||
    typeof notes !== "string" || notes.length > 500
  ) {
    return response.status(400).json({ message: "Booking details are invalid" });
  }
  const start = new Date(`${rentalStartDate}T00:00:00.000Z`);
  const end = new Date(`${rentalEndDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start < new Date(new Date().toISOString().slice(0, 10))) {
    return response.status(400).json({ message: "Rental start date must be today or later" });
  }

  const db = getDatabase();
  let equipment = await db.collection("equipment").findOne({ _id: equipmentId, status: "approved" });
  if (!equipment) return response.status(404).json({ message: "Equipment not found" });
  let lockToken = null;
  for (let attempt = 0; attempt < 8 && !lockToken; attempt += 1) {
    lockToken = await acquireReservationLock(equipmentId);
    if (!lockToken) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }
  if (!lockToken) return response.status(409).json({ message: "Equipment is being booked; try again shortly" });

  let booking;
  try {
    equipment = await db.collection("equipment").findOne({
      _id: equipmentId,
      status: "approved",
    });
    if (!equipment) return response.status(404).json({ message: "Equipment not found" });
    const units = rentalUnits(rentalStartDate, rentalEndDate, equipment.rentalType);
    if (quantity > equipment.availableQuantity) {
      return response.status(409).json({ message: "Requested quantity is not available" });
    }
    const totalAmount = units * equipment.price * quantity;
    if (!Number.isSafeInteger(totalAmount) || !Number.isSafeInteger(totalAmount * 100) || totalAmount <= 0) {
      return response.status(400).json({ message: "Calculated rental amount is invalid" });
    }
    const now = new Date();
    booking = {
      equipmentId,
      equipmentName: equipment.name,
      ownerId: equipment.ownerId,
      customerId: request.user._id,
      rentalStartDate,
      rentalEndDate,
      rentalType: equipment.rentalType,
      units,
      quantity,
      contactNumber: contactNumber.trim(),
      deliveryAddress: deliveryAddress.trim(),
      notes: notes.trim(),
      unitPrice: equipment.price,
      totalAmount,
      currency: config.stripeCurrency,
      paymentStatus: "pending",
      bookingStatus: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const reservedQuantity = await countReservedQuantity(equipmentId, rentalStartDate, rentalEndDate);
    if (reservedQuantity + quantity > equipment.availableQuantity) {
      return response.status(409).json({ message: "Equipment is not available for these dates" });
    }
    booking.checkoutExpiresAt = new Date(Date.now() + 31 * 60 * 1000);
    const inserted = await db.collection("bookings").insertOne(booking);
    booking._id = inserted.insertedId;

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: request.user.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: config.stripeCurrency,
          unit_amount: totalAmount * 100,
          product_data: {
            name: equipment.name,
            description: `${units} ${equipment.rentalType.toLowerCase()} period(s), quantity ${quantity}`,
          },
        },
      }],
      metadata: { bookingId: booking._id.toString() },
      success_url: `${config.clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.clientUrl}/payment/cancel?booking_id=${booking._id}`,
      expires_at: Math.floor(booking.checkoutExpiresAt.getTime() / 1000),
    });
    await db.collection("bookings").updateOne(
      { _id: booking._id },
      { $set: { checkoutSessionId: session.id, updatedAt: new Date() } },
    );
    return response.status(201).json({
      booking: toPublicDocument({ ...booking, checkoutSessionId: session.id }),
      checkoutUrl: session.url,
    });
  } catch (error) {
    if (booking._id) {
      await db.collection("bookings").updateOne(
        { _id: booking._id, paymentStatus: "pending" },
        { $set: { paymentStatus: "failed", bookingStatus: "cancelled", updatedAt: new Date() } },
      );
    }
    throw error;
  } finally {
    await releaseReservationLock(equipmentId, lockToken);
  }
}));

router.post("/:id/cancel-checkout", verifyRenter, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "booking id");
  const bookings = getDatabase().collection("bookings");
  const booking = await bookings.findOne({ _id: id, customerId: request.user._id });
  if (!booking) return response.status(404).json({ message: "Booking not found" });
  if (booking.paymentStatus === "paid") {
    return response.status(409).json({ message: "A paid booking cannot be cancelled from checkout" });
  }
  if (booking.paymentStatus === "failed" && booking.bookingStatus === "cancelled") {
    return response.json({ booking: toPublicDocument(booking) });
  }
  if (booking.paymentStatus !== "pending") {
    return response.status(409).json({ message: "This checkout can no longer be cancelled" });
  }

  if (booking.checkoutSessionId) {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(booking.checkoutSessionId);
    if (session.payment_status === "paid" || session.status === "complete") {
      return response.status(409).json({ message: "Payment is complete or still processing" });
    }
    if (session.status === "open") {
      await stripe.checkout.sessions.expire(session.id);
    }
  }

  await bookings.updateOne(
    { _id: id, customerId: request.user._id, paymentStatus: "pending" },
    { $set: {
      paymentStatus: "failed",
      bookingStatus: "cancelled",
      updatedAt: new Date(),
    } },
  );
  const updated = await bookings.findOne({ _id: id, customerId: request.user._id });
  if (updated?.paymentStatus === "paid") {
    return response.status(409).json({ message: "Payment completed before checkout could be cancelled" });
  }
  if (!updated || updated.paymentStatus !== "failed" || updated.bookingStatus !== "cancelled") {
    return response.status(409).json({ message: "Checkout status changed; refresh and try again" });
  }
  return response.json({ booking: toPublicDocument(updated) });
}));

router.get("/mine", verifyRenter, asyncHandler(async (request, response) => {
  const bookings = await getDatabase().collection("bookings")
    .find({ customerId: request.user._id })
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ items: await hydrateBookings(bookings) });
}));

router.get("/checkout/:sessionId", verifyRenter, asyncHandler(async (request, response) => {
  const { sessionId } = request.params;
  if (!sessionId.startsWith("cs_") || sessionId.length > 255) {
    return response.status(400).json({ message: "Invalid checkout session id" });
  }
  const booking = await getDatabase().collection("bookings").findOne({
    checkoutSessionId: sessionId,
    customerId: request.user._id,
  });
  if (!booking) return response.status(404).json({ message: "Booking not found" });
  response.json({ booking: toPublicDocument(booking) });
}));

router.get("/owner", verifyOwner, asyncHandler(async (request, response) => {
  const bookings = await getDatabase().collection("bookings")
    .find({ ownerId: request.user._id })
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ items: await hydrateBookings(bookings) });
}));

router.get("/admin", verifyAdmin, asyncHandler(async (_request, response) => {
  const bookings = await getDatabase().collection("bookings")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ items: await hydrateBookings(bookings) });
}));

router.patch("/:id/status", [...authenticate, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "booking id");
  const { bookingStatus } = request.body || {};
  if (!BOOKING_STATUSES.includes(bookingStatus)) {
    return response.status(400).json({ message: "Invalid booking status" });
  }
  if (request.user.role === "owner" &&
      !["confirmed", "rejected", "completed"].includes(bookingStatus)) {
    return response.status(403).json({ message: "Owners can confirm, reject, or complete rentals" });
  }
  const db = getDatabase();
  const booking = await db.collection("bookings").findOne({ _id: id });
  if (!booking) return response.status(404).json({ message: "Booking not found" });
  if (
    request.user.role !== "admin" &&
    (request.user.role !== "owner" || !booking.ownerId.equals(request.user._id))
  ) {
    return response.status(403).json({ message: "You cannot manage this booking" });
  }
  if (booking.paymentStatus !== "paid") {
    return response.status(409).json({ message: "Only paid bookings can be managed" });
  }
  if (booking.bookingStatus === "completed" || booking.bookingStatus === "cancelled") {
    return response.status(409).json({ message: "This booking can no longer be changed" });
  }
  if (bookingStatus === "completed" &&
      booking.rentalEndDate > new Date().toISOString().slice(0, 10)) {
    return response.status(409).json({ message: "A rental cannot be completed before its end date" });
  }
  const updated = await db.collection("bookings").findOneAndUpdate(
    { _id: id },
    { $set: { bookingStatus, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  response.json({ booking: toPublicDocument(updated) });
})]);

router.get("/:id", verifyRenter, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "booking id");
  const booking = await getDatabase().collection("bookings").findOne({
    _id: id,
    customerId: request.user._id,
  });
  if (!booking) return response.status(404).json({ message: "Booking not found" });
  response.json({ booking: (await hydrateBookings([booking]))[0] });
}));

async function handleStripeWebhook(request, response) {
  if (!config.stripeWebhookSecret) {
    return response.status(503).json({ message: "Stripe webhooks are not configured" });
  }
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      request.body,
      request.get("stripe-signature"),
      config.stripeWebhookSecret,
    );
  } catch (error) {
    return response.status(400).json({ message: `Invalid Stripe webhook: ${error.message}` });
  }
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    if (session.payment_status !== "paid") return response.json({ received: true });
    const bookingId = parseObjectId(session.metadata?.bookingId, "booking id");
    const db = getDatabase();
    const booking = await db.collection("bookings").findOne({ _id: bookingId });
    if (booking && (
      session.amount_total !== booking.totalAmount * 100 ||
      session.currency !== booking.currency ||
      (booking.checkoutSessionId && booking.checkoutSessionId !== session.id)
    )) {
      return response.status(400).json({ message: "Payment amount does not match the booking" });
    }
    if (booking) {
      await db.collection("bookings").updateOne(
        { _id: bookingId, paymentStatus: "pending" },
        { $set: {
          paymentStatus: "paid",
          paidAt: new Date(),
          checkoutSessionId: session.id,
          updatedAt: new Date(),
        } },
      );
      await db.collection("payments").updateOne(
        { checkoutSessionId: session.id },
        { $setOnInsert: {
          bookingId,
          checkoutSessionId: session.id,
          paymentIntentId: session.payment_intent,
          amount: session.amount_total,
          currency: session.currency,
          status: "paid",
          createdAt: new Date(),
        } },
        { upsert: true },
      );
    }
  } else if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object;
    const bookingId = parseObjectId(session.metadata?.bookingId, "booking id");
    await getDatabase().collection("bookings").updateOne(
      { _id: bookingId, paymentStatus: "pending" },
      { $set: {
        paymentStatus: "failed",
        bookingStatus: "cancelled",
        updatedAt: new Date(),
      } },
    );
  }
  return response.json({ received: true });
}

module.exports = { router, handleStripeWebhook };
