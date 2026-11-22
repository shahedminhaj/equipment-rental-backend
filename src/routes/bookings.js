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

const { notifySafely } = require("../notifications");

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

router.post("/quote", asyncHandler(async (request, response) => {
  const {
    equipmentId: equipmentIdValue,
    rentalStartDate,
    rentalEndDate,
    quantity,
  } = request.body || {};
  const equipmentId = parseObjectId(equipmentIdValue, "equipment id");
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return response.status(400).json({ message: "Quantity must be a positive whole number" });
  }
  const equipment = await getDatabase().collection("equipment").findOne({
    _id: equipmentId,
    status: "approved",
  }, { projection: { name: 1, price: 1, rentalType: 1, availableQuantity: 1 } });
  if (!equipment) return response.status(404).json({ message: "Equipment not found" });
  if (quantity > equipment.availableQuantity) {
    return response.status(409).json({ message: "Requested quantity is not available" });
  }
  const units = rentalUnits(rentalStartDate, rentalEndDate, equipment.rentalType);
  const totalAmount = units * equipment.price * quantity;
  return response.json({
    units,
    unitPrice: equipment.price,
    quantity,
    totalAmount,
    currency: config.stripeCurrency,
  });
}));

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
      payment_method_types: ["card"],
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
      success_url: `${config.clientOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.clientOrigin}/payment/cancel?booking_id=${booking._id}`,
      expires_at: Math.floor(booking.checkoutExpiresAt.getTime() / 1000),
    });
    await db.collection("bookings").updateOne(
      { _id: booking._id },
      { $set: { checkoutSessionId: session.id, updatedAt: new Date() } },
    );
    const owner = await db.collection("users").findOne({ _id: booking.ownerId });
    if (owner) await notifySafely({ sender: request.user, recipients: [owner], type: "booking_request", subject: "New rental request", message: `${request.user.name} requested ${booking.equipmentName} for ${booking.rentalStartDate} to ${booking.rentalEndDate}. The booking is waiting for your confirmation.` });
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
  if (booking.bookingStatus !== "pending") {
    return response.status(409).json({ message: "Only bookings awaiting confirmation can be cancelled" });
  }
  if (booking.paymentStatus === "paid") {
    const db = getDatabase();
    const payment = await db.collection("payments").findOne({ bookingId: id });
    if (!payment?.paymentIntentId) return response.status(409).json({ message: "A refundable payment could not be found for this booking" });
    if (payment.status !== "refunded") {
      const refund = await getStripe().refunds.create(
        { payment_intent: payment.paymentIntentId },
        { idempotencyKey: `booking-refund-${id.toString()}` },
      );
      await db.collection("payments").updateOne({ _id: payment._id, status: "paid" }, { $set: { status: "refunded", refundId: refund.id, refundedAt: new Date() } });
    }
    const updated = await db.collection("bookings").findOneAndUpdate(
      { _id: id, customerId: request.user._id, bookingStatus: "pending", paymentStatus: "paid" },
      { $set: { bookingStatus: "cancelled", paymentStatus: "refunded", refundedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) return response.status(409).json({ message: "The booking changed while its refund was processing" });
    const owner = await db.collection("users").findOne({ _id: updated.ownerId });
    if (owner) await notifySafely({ sender: request.user, recipients: [owner], type: "booking_status", subject: "Booking cancelled", message: `The renter cancelled the pending booking for ${updated.equipmentName}. Their payment is being refunded.` });
    return response.json({ booking: toPublicDocument(updated) });
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
  const owner = await getDatabase().collection("users").findOne({ _id: updated.ownerId });
  if (owner) await notifySafely({ sender: request.user, recipients: [owner], type: "booking_status", subject: "Booking cancelled", message: `The renter cancelled the pending booking for ${updated.equipmentName}.` });
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
  const bookings = getDatabase().collection("bookings");
  const booking = await bookings.findOne({
    checkoutSessionId: sessionId,
    customerId: request.user._id,
  });
  if (!booking) return response.status(404).json({ message: "Booking not found" });

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (
    session.metadata?.bookingId !== booking._id.toString() ||
    session.amount_total !== booking.totalAmount * 100 ||
    session.currency !== booking.currency ||
    session.id !== booking.checkoutSessionId
  ) {
    return response.status(400).json({ message: "Stripe Checkout does not match this booking" });
  }

  if (session.status === "complete" && session.payment_status === "paid") {
    if (booking.paymentStatus === "failed" || booking.bookingStatus === "cancelled") {
      return response.status(409).json({ message: "This booking was cancelled before payment confirmation" });
    }
    const paidAt = booking.paidAt || new Date();
    await bookings.updateOne(
      { _id: booking._id, paymentStatus: "pending" },
      { $set: {
        paymentStatus: "paid",
        paidAt,
        updatedAt: new Date(),
      } },
    );
    await getDatabase().collection("payments").updateOne(
      { checkoutSessionId: session.id },
      { $setOnInsert: {
        bookingId: booking._id,
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent,
        amount: session.amount_total,
        currency: session.currency,
        status: "paid",
        createdAt: paidAt,
      } },
      { upsert: true },
    );
  } else if (session.status === "expired") {
    await bookings.updateOne(
      { _id: booking._id, paymentStatus: "pending" },
      { $set: {
        paymentStatus: "failed",
        bookingStatus: "cancelled",
        updatedAt: new Date(),
      } },
    );
  }

  const updatedBooking = await bookings.findOne({ _id: booking._id });
  response.json({ booking: toPublicDocument(updatedBooking) });
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
  if (booking.bookingStatus === bookingStatus && booking.paymentStatus === "refunded") {
    return response.json({ booking: toPublicDocument(booking) });
  }
  if (bookingStatus === "completed" &&
      booking.rentalEndDate > new Date().toISOString().slice(0, 10)) {
    return response.status(409).json({ message: "A rental cannot be completed before its end date" });
  }
  if (["rejected", "cancelled"].includes(bookingStatus)) {
    const payment = await db.collection("payments").findOne({ bookingId: id });
    if (!payment || (payment.status !== "refunded" && !payment.paymentIntentId)) {
      return response.status(409).json({ message: "A refundable Stripe payment could not be found for this booking" });
    }
    if (payment.status !== "refunded") {
      const refund = await getStripe().refunds.create(
        { payment_intent: payment.paymentIntentId },
        { idempotencyKey: `booking-refund-${id.toString()}` },
      );
      await db.collection("payments").updateOne(
        { _id: payment._id, status: "paid" },
        { $set: { status: "refunded", refundId: refund.id, refundedAt: new Date() } },
      );
    }
    const updated = await db.collection("bookings").findOneAndUpdate(
      { _id: id, paymentStatus: "paid" },
      { $set: { bookingStatus, paymentStatus: "refunded", refundedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) {
      return response.status(409).json({ message: "The booking changed while its refund was processing; refresh and review its status" });
    }
    await notifyRenter(updated, request.user, bookingStatus);
    return response.json({ booking: toPublicDocument(updated) });
  }
  const updated = await db.collection("bookings").findOneAndUpdate(
    { _id: id, bookingStatus: booking.bookingStatus, paymentStatus: "paid" },
    { $set: { bookingStatus, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) return response.status(409).json({ message: "The booking changed; refresh and try again" });
  await notifyRenter(updated, request.user, bookingStatus);
  response.json({ booking: toPublicDocument(updated) });
})]);

async function notifyRenter(booking, sender, status) {
  const renter = await getDatabase().collection("users").findOne({ _id: booking.customerId });
  if (!renter) return;
  const actor = sender.role === "admin" ? "The admin team" : "The equipment owner";
  const message = status === "confirmed"
    ? `${actor} confirmed your booking for ${booking.equipmentName}.`
    : status === "rejected" || status === "cancelled"
      ? `${actor} ${status === "rejected" ? "declined" : "cancelled"} your booking for ${booking.equipmentName}${booking.paymentStatus === "refunded" ? ". Your refund is being processed." : "."}`
      : status === "completed"
        ? `Your rental for ${booking.equipmentName} is complete.`
        : `Your booking for ${booking.equipmentName} is now ${status}.`;
  await notifySafely({ sender, recipients: [renter], type: "booking_status", subject: `Booking ${status}`, message });
}

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
  const paidEvents = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  const failedEvents = ["checkout.session.expired", "checkout.session.async_payment_failed"];
  if (!paidEvents.includes(event.type) && !failedEvents.includes(event.type)) {
    // Stripe sends many unrelated events; acknowledge them instead of erroring.
    return response.json({ received: true });
  }

  const session = event.data.object;
  let bookingId;
  try {
    bookingId = parseObjectId(session.metadata?.bookingId, "booking id");
  } catch {
    // A signed event from another Checkout session is not an error on our side.
    return response.json({ received: true, ignored: true });
  }

  const db = getDatabase();
  const booking = await db.collection("bookings").findOne({ _id: bookingId });
  if (!booking) return response.json({ received: true, ignored: true });

  if (paidEvents.includes(event.type)) {
    if (session.payment_status !== "paid") return response.json({ received: true });
    if (
      session.amount_total !== booking.totalAmount * 100 ||
      session.currency !== booking.currency ||
      (booking.checkoutSessionId && booking.checkoutSessionId !== session.id)
    ) {
      // Replying 400 makes Stripe retry forever; log and acknowledge instead.
      console.error(`Stripe payment mismatch for booking ${bookingId}`);
      return response.json({ received: true, ignored: true });
    }
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
  } else {
    await db.collection("bookings").updateOne(
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
