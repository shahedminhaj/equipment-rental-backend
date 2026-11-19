const crypto = require("node:crypto");
const { getDatabase } = require("./db");

async function acquireReservationLock(equipmentId) {
  const locks = getDatabase().collection("reservationLocks");
  const token = crypto.randomUUID();
  const now = new Date();
  try {
    await locks.findOneAndUpdate(
      { _id: equipmentId, $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }] },
      { $set: { token, expiresAt: new Date(now.getTime() + 30_000) } },
      { upsert: true, returnDocument: "after" },
    );
    return token;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

function releaseReservationLock(equipmentId, token) {
  return getDatabase().collection("reservationLocks").deleteOne({
    _id: equipmentId,
    token,
  });
}

module.exports = { acquireReservationLock, releaseReservationLock };
