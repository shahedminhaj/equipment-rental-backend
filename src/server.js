require("dotenv").config();

const app = require("./app");
const config = require("./config");
const { closeDatabase, connectToDatabase } = require("./db");
const { startStatusJobs } = require("./jobs");
const { ensureConfiguredAdmin, seedCatalog } = require("./seed");

async function start() {
  const database = await connectToDatabase();
  const admin = await ensureConfiguredAdmin(database);
  const seededItems = await seedCatalog(database);
  const statusJob = startStatusJobs();

  const server = app.listen(config.port, () => {
    console.log(`Equipment rental API listening on port ${config.port}`);
    if (admin) console.log(`Administrator ready: ${admin.email}`);
    if (seededItems) console.log(`Seeded ${seededItems} approved demo listings`);
  });

  async function shutdown() {
    statusJob.stop();
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
