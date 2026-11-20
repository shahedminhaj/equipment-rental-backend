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
    const admins = await users.find(
      { role: "admin" },
      { projection: { email: 1 } },
    ).sort({ createdAt: 1, _id: 1 }).toArray();
    const adminToKeep = config.adminEmail
      ? admins.find((admin) => admin.email === config.adminEmail)
      : admins[0];
    const adminIdsToDemote = admins
      .filter((admin) => !adminToKeep || !admin._id.equals(adminToKeep._id))
      .map((admin) => admin._id);
    if (adminIdsToDemote.length) {
      await users.updateMany(
        { _id: { $in: adminIdsToDemote } },
        { $set: { role: "customer", updatedAt: new Date() } },
      );
    }
    await Promise.all([
      users.createIndex({ email: 1 }, { unique: true }),
      users.createIndex(
        { role: 1 },
        { unique: true, partialFilterExpression: { role: "admin" } },
      ),
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
