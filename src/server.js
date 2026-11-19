require("dotenv").config();

const bcrypt = require("bcryptjs");
const app = require("./app");
const config = require("./config");
const { closeDatabase, connectToDatabase } = require("./db");

async function ensureConfiguredAdmin() {
  if (!config.adminEmail && !config.adminPassword) return;
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision the administrator");
  }
  if (config.adminPassword.length < 6) {
    throw new Error("ADMIN_PASSWORD must be at least 6 characters long");
  }
  const users = (await connectToDatabase()).collection("users");
  await users.updateOne(
    { email: config.adminEmail },
    {
      $set: { role: "admin", updatedAt: new Date() },
      $setOnInsert: {
        name: "Administrator",
        email: config.adminEmail,
        passwordHash: await bcrypt.hash(config.adminPassword, 12),
        photo: "",
        phone: "",
        address: "",
        provider: "password",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function start() {
  await connectToDatabase();
  await ensureConfiguredAdmin();
  const server = app.listen(config.port, () => {
    console.log(`Equipment rental API listening on port ${config.port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Could not start the API server:", error);
  process.exitCode = 1;
});
