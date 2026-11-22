const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, parseObjectId, verifyAdmin } = require("../middleware");
const { pagination, ROLES, toPublicDocument } = require("../domain");
const config = require("../config");

const { notifySafely } = require("../notifications");

const router = Router();

router.get("/users", verifyAdmin, asyncHandler(async (request, response) => {
  const { page, limit, skip } = pagination(request.query);
  const filter = {};
  if (request.query.role) {
    if (!ROLES.includes(request.query.role)) {
      return response.status(400).json({ message: "Invalid user role" });
    }
    filter.role = request.query.role;
  }
  const users = getDatabase().collection("users");
  const [items, total] = await Promise.all([
    users.find(filter, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    users.countDocuments(filter),
  ]);
  response.json({ items: items.map(toPublicDocument), total, page, limit, pages: Math.ceil(total / limit) });
}));

router.patch("/users/:id/role", verifyAdmin, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "user id");
  const { role } = request.body || {};
  if (!ROLES.includes(role)) return response.status(400).json({ message: "Invalid user role" });
  if (id.equals(request.user._id)) {
    return response.status(400).json({ message: "You cannot change your own role" });
  }

  const users = getDatabase().collection("users");
  const existingUser = await users.findOne({ _id: id }, { projection: { email: 1, role: 1 } });
  if (!existingUser) return response.status(404).json({ message: "User not found" });
  if (config.adminEmail && existingUser.email === config.adminEmail) {
    return response.status(400).json({ message: "The configured administrator role cannot be changed" });
  }
  const user = await users.findOneAndUpdate(
    { _id: id },
    { $set: { role, updatedAt: new Date() } },
    { returnDocument: "after", projection: { passwordHash: 0 } },
  );
  if (!user) return response.status(404).json({ message: "User not found" });
  await notifySafely({ sender: request.user, recipients: [user], type: "account_role", subject: "Your account role changed", message: `An administrator changed your Fieldkit role to ${role}.` });
  response.json({ user: toPublicDocument(user) });
}));

router.patch("/users/:id/status", verifyAdmin, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "user id");
  if (id.equals(request.user._id)) {
    return response.status(400).json({ message: "You cannot disable your own account" });
  }
  if (typeof request.body?.disabled !== "boolean") {
    return response.status(400).json({ message: "disabled must be true or false" });
  }
  const user = await getDatabase().collection("users").findOneAndUpdate(
    { _id: id },
    { $set: { disabled: request.body.disabled, updatedAt: new Date() } },
    { returnDocument: "after", projection: { passwordHash: 0 } },
  );
  if (!user) return response.status(404).json({ message: "User not found" });
  await notifySafely({ sender: request.user, recipients: [user], type: "account_status", subject: `Account ${request.body.disabled ? "disabled" : "enabled"}`, message: `An administrator ${request.body.disabled ? "disabled" : "re-enabled"} your Fieldkit account.` });
  response.json({ user: toPublicDocument(user) });
}));

router.get("/equipment", verifyAdmin, asyncHandler(async (request, response) => {
  const { page, limit, skip } = pagination(request.query);
  const filter = {};
  if (request.query.status) {
    if (!["pending", "approved", "rejected"].includes(request.query.status)) {
      return response.status(400).json({ message: "Invalid equipment status" });
    }
    filter.status = request.query.status;
  }
  const equipment = getDatabase().collection("equipment");
  const [items, total] = await Promise.all([
    equipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    equipment.countDocuments(filter),
  ]);
  response.json({ items: items.map(toPublicDocument), total, page, limit, pages: Math.ceil(total / limit) });
}));

router.post("/equipment", verifyAdmin, asyncHandler(async (request, response) => {
  const body = request.body || {};
  const requiredText = ["name", "category", "location", "image"];
  if (requiredText.some((field) => typeof body[field] !== "string" || !body[field].trim() || body[field].length > 2048)) {
    return response.status(400).json({ message: "Name, category, location, and image URL are required" });
  }
  if (!Number.isSafeInteger(body.price) || body.price <= 0) {
    return response.status(400).json({ message: "Price must be a positive whole number" });
  }
  if (!["Daily", "Weekly", "Monthly"].includes(body.rentalType)) {
    return response.status(400).json({ message: "Invalid rental type" });
  }
  if (!Number.isSafeInteger(body.availableQuantity) || body.availableQuantity < 0) {
    return response.status(400).json({ message: "Available quantity must be a non-negative whole number" });
  }
  for (const field of ["description", "condition", "brand", "model"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 5000)) {
      return response.status(400).json({ message: `${field} must be text no longer than 5000 characters` });
    }
  }

  const now = new Date();
  const item = {
    name: body.name.trim(),
    description: typeof body.description === "string" ? body.description.trim() : "",
    category: body.category.trim(),
    location: body.location.trim(),
    image: body.image.trim(),
    price: body.price,
    rentalType: body.rentalType,
    availableQuantity: body.availableQuantity,
    condition: typeof body.condition === "string" ? body.condition.trim() : "Good",
    brand: typeof body.brand === "string" ? body.brand.trim() : "",
    model: typeof body.model === "string" ? body.model.trim() : "",
    rentalTerms: [],
    ownerId: request.user._id,
    status: "approved",
    createdAt: now,
    updatedAt: now,
  };
  const result = await getDatabase().collection("equipment").insertOne(item);
  item._id = result.insertedId;
  response.status(201).json({ item: toPublicDocument(item) });
}));
router.patch("/equipment/:id/status", verifyAdmin, asyncHandler(async (request, response) => {
  const id = parseObjectId(request.params.id, "equipment id");
  const { status } = request.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return response.status(400).json({ message: "Status must be approved or rejected" });
  }
  const item = await getDatabase().collection("equipment").findOneAndUpdate(
    { _id: id },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!item) return response.status(404).json({ message: "Equipment not found" });
  const owner = await getDatabase().collection("users").findOne({ _id: item.ownerId });
  if (owner) await notifySafely({ sender: request.user, recipients: [owner], type: "equipment_status", subject: `Equipment listing ${status}`, message: `Your listing “${item.name}” was ${status} by the admin team.` });
  response.json({ item: toPublicDocument(item) });
}));

module.exports = router;
