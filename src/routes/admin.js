const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, parseObjectId, verifyAdmin } = require("../middleware");
const { pagination, ROLES, toPublicDocument } = require("../domain");
const config = require("../config");

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
  if (role === "admin") {
    const currentAdmin = await users.findOne({ role: "admin", _id: { $ne: id } }, { projection: { _id: 1 } });
    if (currentAdmin) {
      return response.status(409).json({ message: "Another admin already exists. Demote the current admin first." });
    }
  }

  const user = await users.findOneAndUpdate(
    { _id: id },
    { $set: { role, updatedAt: new Date() } },
    { returnDocument: "after", projection: { passwordHash: 0 } },
  );
  if (!user) return response.status(404).json({ message: "User not found" });
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
  response.json({ item: toPublicDocument(item) });
}));

module.exports = router;
