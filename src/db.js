const { MongoClient } = require("mongodb");
const config = require("./config");

const client = new MongoClient(config.mongoUri);
let database;

async function connectToDatabase() {
  if (!database) {
    await client.connect();
    database = config.mongoDb
      ? client.db(config.mongoDb)
      : client.db();
    await Promise.all([
      database.collection("users").createIndex({ email: 1 }, { unique: true }),
      database.collection("favorites").createIndex(
        { userId: 1, equipmentId: 1 },
        { unique: true },
      ),
      database.collection("bookings").createIndex({ customerId: 1, createdAt: -1 }),
      database.collection("bookings").createIndex({ ownerId: 1, createdAt: -1 }),
      database.collection("equipment").createIndex({ status: 1, createdAt: -1 }),
      database.collection("payments").createIndex(
        { checkoutSessionId: 1 },
        { unique: true, sparse: true },
      ),
    ]);
  }
  return database;
}

function getDatabase() {
  if (!database) throw new Error("Database has not been connected");
  return database;
}

async function closeDatabase() {
  database = undefined;
  await client.close();
}

module.exports = { connectToDatabase, getDatabase, closeDatabase };
