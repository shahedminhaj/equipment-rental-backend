const { Router } = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const config = require("../config");
const { getDatabase } = require("../db");
const { asyncHandler, authenticate } = require("../middleware");
const { toPublicDocument } = require("../domain");

const router = Router();
const googleClient = config.googleClientId
  ? new OAuth2Client(config.googleClientId)
  : null;

function issueToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function validEmail(email) {
  return typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254;
}

router.post("/register", asyncHandler(async (request, response) => {
  const { name, email, password, photo } = request.body || {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
    !validEmail(normalizedEmail) ||
    typeof password !== "string" || password.length < 6 ||
    !/[A-Z]/.test(password) || !/[a-z]/.test(password)
  ) {
    return response.status(400).json({
      message: "Provide a name, valid email, and a password with uppercase/lowercase letters and at least 6 characters",
    });
  }
  if (photo !== undefined && (typeof photo !== "string" || photo.length > 2048)) {
    return response.status(400).json({ message: "Invalid profile image URL" });
  }

  const users = getDatabase().collection("users");
  if (await users.findOne({ email: normalizedEmail }, { projection: { _id: 1 } })) {
    return response.status(409).json({ message: "An account with this email already exists" });
  }
  const user = {
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    photo: photo?.trim() || "",
    role: "customer",
    phone: "",
    address: "",
    provider: "password",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await users.insertOne(user);
  user._id = result.insertedId;
  return response.status(201).json({ token: issueToken(user), user: toPublicDocument(user) });
}));

router.post("/login", asyncHandler(async (request, response) => {
  const email = typeof request.body?.email === "string"
    ? request.body.email.trim().toLowerCase()
    : "";
  const password = request.body?.password;
  if (!validEmail(email) || typeof password !== "string") {
    return response.status(400).json({ message: "Email and password are required" });
  }
  const user = await getDatabase().collection("users").findOne({ email, disabled: { $ne: true } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return response.status(401).json({ message: "Email or password is incorrect" });
  }
  return response.json({ token: issueToken(user), user: toPublicDocument(user) });
}));

router.post("/google", asyncHandler(async (request, response) => {
  if (!googleClient) {
    return response.status(503).json({ message: "Google sign-in is not configured" });
  }
  const { credential } = request.body || {};
  if (typeof credential !== "string" || credential.length > 8192) {
    return response.status(400).json({ message: "A Google ID token is required" });
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const profile = ticket.getPayload();
  if (!profile?.sub || !profile.email || profile.email_verified !== true) {
    return response.status(401).json({ message: "Google account must have a verified email" });
  }

  const users = getDatabase().collection("users");
  let user = await users.findOne({ email: profile.email.toLowerCase() });
  if (!user) {
    user = {
      name: profile.name || profile.email.split("@")[0],
      email: profile.email.toLowerCase(),
      photo: profile.picture || "",
      role: "customer",
      phone: "",
      address: "",
      provider: "google",
      googleSubject: profile.sub,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await users.insertOne(user);
    user._id = result.insertedId;
  } else if (user.disabled) {
    return response.status(403).json({ message: "This account is disabled" });
  }
  return response.json({ token: issueToken(user), user: toPublicDocument(user) });
}));

router.get("/me", authenticate, (request, response) => {
  response.json({ user: toPublicDocument(request.user) });
});

module.exports = router;
