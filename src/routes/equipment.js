const { Router } = require("express");
const { getDatabase } = require("../db");
const { acquireReservationLock, releaseReservationLock } = require("../reservation-lock");
const {
  asyncHandler,
  authenticate,
  parseObjectId,
  verifyOwner,
} = require("../middleware");
const {
  EQUIPMENT_STATUSES,
  RENTAL_TYPES,
  equipmentFilter,
  equipmentSort,
  pagination,
  toPublicDocument,
} = require("../domain");

const router = Router();
const requiredTextFields = ["name", "category", "location", "image"];

function validateEquipment(input, partial = false) {
  const invalid = (message) => {
    const error = new Error(message);
    error.status = 400;
    return error;
  };
  const errorMessage = "Equipment requires a name, category, location, image, price, rental type, and quantity";
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid(errorMessage);
  for (const field of requiredTextFields) {
    if ((!partial || input[field] !== undefined) &&
        (typeof input[field] !== "string" || !input[field].trim() || input[field].length > 2048)) {
      throw invalid(errorMessage);
    }
  }
  for (const field of ["description", "condition", "brand", "model"]) {
    if (
      input[field] !== undefined &&
      (typeof input[field] !== "string" || input[field].length > 5000)
    ) {
      throw invalid(`${field} must be text no longer than 5000 characters`);
    }
  }
  if (!partial || input.price !== undefined) {
    if (typeof input.price !== "number" || !Number.isSafeInteger(input.price) || input.price <= 0) {
      throw invalid("Price must be a positive whole number");
    }
  }
  if (!partial || input.rentalType !== undefined) {
    if (!RENTAL_TYPES.includes(input.rentalType)) throw invalid("Invalid rental type");
  }
  if (!partial || input.availableQuantity !== undefined) {
    if (!Number.isSafeInteger(input.availableQuantity) || input.availableQuantity < 0) {
      throw invalid("Available quantity must be a non-negative whole number");
    }
  }
  for (const field of ["rentalTerms", "tags"]) {
    if (
      input[field] !== undefined &&
      (!Array.isArray(input[field]) ||
        input[field].length > 50 ||
        input[field].some((value) => typeof value !== "string" || value.length > 500))
    ) {
      throw invalid(`${field} must be a list of short text values`);
    }
  }
}

function sanitizeEquipmentInput(input) {
  const fields = [
    "name", "description", "category", "location", "price", "rentalType",
    "availableQuantity", "condition", "brand", "model", "image",
    "rentalTerms", "tags",
  ];
  return Object.fromEntries(fields
    .filter((field) => input[field] !== undefined)
    .map((field) => [field, input[field]]));
}

router.get("/", asyncHandler(async (request, response) => {
  const { page, limit, skip } = pagination(request.query);
  const filter = equipmentFilter(request.query);
  const sort = equipmentSort(request.query.sort);
  const collection = getDatabase().collection("equipment");
  const [items, total] = await Promise.all([
    collection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);
  response.json({ items: items.map(toPublicDocument), total, page, limit, pages: Math.ceil(total / limit) });
}));

router.get("/featured", asyncHandler(async (_request, response) => {
  const items = await getDatabase().collection("equipment")
    .find({ status: "approved" })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  response.json({ items: items.map(toPublicDocument) });
}));

router.get("/owner/mine", verifyOwner, asyncHandler(async (request, response) => {
  const items = await getDatabase().collection("equipment")
    .find({ ownerId: request.user._id })
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ items: items.map(toPublicDocument) });
}));

router.get("/:id", asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "equipment id");
  const equipment = await getDatabase().collection("equipment").findOne({
    _id: id,
    status: "approved",
  });
  if (!equipment) return response.status(404).json({ message: "Equipment not found" });
  const owner = await getDatabase().collection("users").findOne(
    { _id: equipment.ownerId },
    { projection: { name: 1, photo: 1, email: 1, _id: 0 } },
  );
  response.json({ item: { ...toPublicDocument(equipment), owner: owner || null } });
}));

router.post("/", verifyOwner, asyncHandler(async (request, response) => {
  validateEquipment(request.body);
  const now = new Date();
  const equipment = {
    ...sanitizeEquipmentInput(request.body),
    description: typeof request.body.description === "string" ? request.body.description : "",
    rentalTerms: Array.isArray(request.body.rentalTerms) ? request.body.rentalTerms : [],
    ownerId: request.user._id,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const result = await getDatabase().collection("equipment").insertOne(equipment);
  equipment._id = result.insertedId;
  response.status(201).json({ item: toPublicDocument(equipment) });
}));

router.patch("/:id", [...authenticate, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "equipment id");
  const equipmentCollection = getDatabase().collection("equipment");
  const existing = await equipmentCollection.findOne({ _id: id });
  if (!existing) return response.status(404).json({ message: "Equipment not found" });
  if (request.user.role !== "admin" &&
      (request.user.role !== "owner" || !existing.ownerId.equals(request.user._id))) {
    return response.status(403).json({ message: "You cannot update this equipment" });
  }
  validateEquipment(request.body, true);
  const changes = sanitizeEquipmentInput(request.body);
  if (request.user.role !== "admin" && Object.hasOwn(request.body, "status")) {
    return response.status(403).json({ message: "Only administrators can change approval status" });
  }
  if (request.user.role === "admin" && request.body.status !== undefined) {
    if (!EQUIPMENT_STATUSES.includes(request.body.status)) {
      return response.status(400).json({ message: "Invalid equipment status" });
    }
    changes.status = request.body.status;
  }
  const updated = await equipmentCollection.findOneAndUpdate(
    { _id: id },
    { $set: { ...changes, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  response.json({ item: toPublicDocument(updated) });
})]);

router.delete("/:id", [...authenticate, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "equipment id");
  const equipmentCollection = getDatabase().collection("equipment");
  let item = await equipmentCollection.findOne({ _id: id });
  if (!item) return response.status(404).json({ message: "Equipment not found" });
  if (request.user.role !== "admin" &&
      (request.user.role !== "owner" || !item.ownerId.equals(request.user._id))) {
    return response.status(403).json({ message: "You cannot delete this equipment" });
  }
  const lockToken = await acquireReservationLock(id);
  if (!lockToken) return response.status(409).json({ message: "Equipment is being booked; try again shortly" });
  try {
    item = await equipmentCollection.findOne({ _id: id });
    if (!item) return response.status(404).json({ message: "Equipment not found" });
    if (request.user.role !== "admin" &&
        (request.user.role !== "owner" || !item.ownerId.equals(request.user._id))) {
      return response.status(403).json({ message: "You cannot delete this equipment" });
    }
    const activeBooking = await getDatabase().collection("bookings").findOne({
      equipmentId: id,
      $or: [
        { paymentStatus: "paid", bookingStatus: { $in: ["pending", "confirmed"] } },
        { paymentStatus: "pending", checkoutExpiresAt: { $gt: new Date() } },
      ],
    });
    if (activeBooking) {
      return response.status(409).json({ message: "Equipment with active rentals cannot be deleted" });
    }
    await Promise.all([
      equipmentCollection.deleteOne({ _id: id }),
      getDatabase().collection("favorites").deleteMany({ equipmentId: id }),
    ]);
    return response.status(204).end();
  } finally {
    await releaseReservationLock(id, lockToken);
  }
})]);

module.exports = router;
