const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const configRoutes = require("./routes/config");
const { getDatabase } = require("./db");
const authRoutes = require("./routes/auth");
const equipmentRoutes = require("./routes/equipment");
const favoriteRoutes = require("./routes/favorites");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");
const { router: bookingRoutes, handleStripeWebhook } = require("./routes/bookings");
const paymentRoutes = require("./routes/payments");

const app = express();
const allowedOrigins = config.clientUrl.split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));

app.post("/api/payments/webhook", express.raw({ type: "application/json" }), (request, response, next) => {
  Promise.resolve(handleStripeWebhook(request, response)).catch(next);
});
app.use(express.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.json({
    service: "equipment-rental-api",
    status: "ok",
    health: "/api/health",
  });
});

app.get("/api/health", async (_request, response) => {
  try {
    await getDatabase().admin().ping();
    return response.json({ status: "ok", database: "connected" });
  } catch {
    return response.status(503).json({ status: "unavailable", database: "disconnected" });
  }
});

app.use("/api/config", configRoutes);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/equipment", equipmentRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use((_request, response) => {
  response.status(404).json({ message: "Route not found" });
});

app.use((error, _request, response, _next) => {
  if (error.code === 11000) {
    return response.status(409).json({ message: "A record with these details already exists" });
  }
  const status = error.status || (error instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error(error);
  return response.status(status).json({
    message: status >= 500 ? "Internal server error" : error.message,
  });
});

module.exports = app;
