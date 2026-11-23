const required = ["MONGODB_URI", "JWT_SECRET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long");
}

if (Boolean(process.env.ADMIN_EMAIL) !== Boolean(process.env.ADMIN_PASSWORD)) {
  throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD, or leave both unset");
}
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 6) {
  throw new Error("ADMIN_PASSWORD must be at least 6 characters long");
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

const clientOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .map(normalizeOrigin)
  .filter(Boolean);

module.exports = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGODB_URI,
  mongoDb: process.env.MONGODB_DB,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientUrl: clientOrigins[0] || "http://localhost:3000",
  // CORS accepts multiple origins, but Stripe redirects must use a single URL.
  clientOrigins,
  clientOrigin: clientOrigins[0] || "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripeCurrency: (process.env.STRIPE_CURRENCY || "bdt").toLowerCase(),
  adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD,
  nodeEnv: process.env.NODE_ENV || "development",
};
