const { MongoClient } = require("mongodb");
const config = require("./config");

const client = new MongoClient(config.mongoUri);
let database;
let connectionPromise;

async function connectToDatabase() {
  if (database) return database;
  if (!connectionPromise) {
    connectionPromise = (async () => {
      await client.connect();
      const connectedDatabase = config.mongoDb
        ? client.db(config.mongoDb)
        : client.db();
      const users = connectedDatabase.collection("users");
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
        connectedDatabase.collection("favorites").createIndex(
          { userId: 1, equipmentId: 1 },
          { unique: true },
        ),
        connectedDatabase.collection("bookings").createIndex({ customerId: 1, createdAt: -1 }),
        connectedDatabase.collection("bookings").createIndex({ ownerId: 1, createdAt: -1 }),
        connectedDatabase.collection("equipment").createIndex({ status: 1, createdAt: -1 }),
        connectedDatabase.collection("equipment").createIndex({ status: 1, category: 1, rentalType: 1 }),
        connectedDatabase.collection("equipment").createIndex({ status: 1, location: 1 }),
        connectedDatabase.collection("payments").createIndex(
          { checkoutSessionId: 1 },
          { unique: true, sparse: true },
        ),
        connectedDatabase.collection("reviews").createIndex(
          { bookingId: 1 },
          { unique: true, sparse: true },
        ),
        connectedDatabase.collection("reviews").createIndex({ customerId: 1, createdAt: -1 }),
        connectedDatabase.collection("notifications").createIndex({ recipientId: 1, createdAt: -1 }),
        connectedDatabase.collection("notifications").createIndex({ senderId: 1, createdAt: -1 }),
      ]);
      database = connectedDatabase;
      return database;
    })().catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  }
  return connectionPromise;
}

function getDatabase() {
  if (!database) throw new Error("Database has not been connected");
  return database;
}

async function closeDatabase() {
  database = undefined;
  connectionPromise = undefined;
  await client.close();
}

module.exports = { connectToDatabase, getDatabase, closeDatabase };
