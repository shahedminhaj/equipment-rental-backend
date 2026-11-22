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
    const users = database.collection("users");
    // Older versions enforced a single admin with a unique partial index. That
    // prevented admins from promoting other users, so migrate it to a normal
    // index instead of silently demoting role changes on every restart.
    const indexes = await users.listIndexes().toArray();
    if (indexes.some((index) => index.name === "role_1" && index.unique)) {
      await users.dropIndex("role_1");
    }
    await Promise.all([
      users.createIndex({ email: 1 }, { unique: true }),
      users.createIndex({ role: 1 }),
      database.collection("favorites").createIndex(
        { userId: 1, equipmentId: 1 },
        { unique: true },
      ),
      database.collection("bookings").createIndex({ customerId: 1, createdAt: -1 }),
      database.collection("bookings").createIndex({ ownerId: 1, createdAt: -1 }),
      database.collection("equipment").createIndex({ status: 1, createdAt: -1 }),
      database.collection("equipment").createIndex({ status: 1, category: 1, rentalType: 1 }),
      database.collection("equipment").createIndex({ status: 1, location: 1 }),
      database.collection("payments").createIndex(
        { checkoutSessionId: 1 },
        { unique: true, sparse: true },
      ),
      database.collection("reviews").createIndex(
        { bookingId: 1 },
        { unique: true, sparse: true },
      ),
      database.collection("reviews").createIndex({ customerId: 1, createdAt: -1 }),
      database.collection("notifications").createIndex({ recipientId: 1, createdAt: -1 }),
      database.collection("notifications").createIndex({ senderId: 1, createdAt: -1 }),
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
