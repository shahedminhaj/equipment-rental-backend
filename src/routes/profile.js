const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, authenticate } = require("../middleware");
const { toPublicDocument } = require("../domain");

const router = Router();

router.get("/", authenticate, (request, response) => {
  response.json({ user: toPublicDocument(request.user) });
});

router.patch("/", authenticate, asyncHandler(async (request, response) => {
  const { name, email, photo, phone, address } = request.body || {};
  const users = getDatabase().collection("users");
  const updates = {};
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
      return response.status(400).json({ message: "Name must be between 2 and 100 characters" });
    }
    updates.name = name.trim();
  }
  if (email !== undefined) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return response.status(400).json({ message: "Email address is invalid" });
    }
    const conflict = await users.findOne({ email: normalizedEmail, _id: { $ne: request.user._id } });
    if (conflict) {
      return response.status(409).json({ message: "Email address is already in use" });
    }
    updates.email = normalizedEmail;
  }
  if (photo !== undefined) {
    if (typeof photo !== "string" || photo.length > 2048) {
      return response.status(400).json({ message: "Profile image URL is invalid" });
    }
    updates.photo = photo.trim();
  }
  if (phone !== undefined) {
    if (typeof phone !== "string" || phone.length > 30) {
      return response.status(400).json({ message: "Phone number is invalid" });
    }
    updates.phone = phone.trim();
  }
  if (address !== undefined) {
    if (typeof address !== "string" || address.length > 300) {
      return response.status(400).json({ message: "Address is invalid" });
    }
    updates.address = address.trim();
  }
  if (Object.keys(updates).length === 0) {
    return response.status(400).json({ message: "Provide at least one profile field to update" });
  }
  updates.updatedAt = new Date();
  const user = await users.findOneAndUpdate(
    { _id: request.user._id },
    { $set: updates },
    { returnDocument: "after" },
  );
  response.json({ user: toPublicDocument(user) });
}));

module.exports = router;
