const { ObjectId } = require("mongodb");
const { getDatabase } = require("./db");

function messageRows({ sender, recipients, subject, message, type = "message", createdAt = new Date() }) {
  const uniqueRecipients = [...new Map((recipients || [])
    .map((recipient) => [recipient._id.toString(), recipient])).values()];
  if (!uniqueRecipients.length) return [];
  const messageId = new ObjectId();
  return uniqueRecipients.map((recipient) => ({
    messageId,
    type,
    senderId: sender._id,
    senderName: sender.name,
    senderRole: sender.role,
    recipientId: recipient._id,
    recipientName: recipient.name,
    recipientRole: recipient.role,
    subject,
    message,
    createdAt,
    readAt: null,
  }));
}

async function writeNotifications(payload) {
  const rows = messageRows(payload);
  if (!rows.length) return [];
  const result = await getDatabase().collection("notifications").insertMany(rows);
  return rows.map((row, index) => ({ ...row, _id: result.insertedIds[index] }));
}

async function notifySafely(payload) {
  try {
    await writeNotifications(payload);
  } catch (error) {
    console.error("Could not save inbox activity:", error.message);
  }
}

async function notifyAdminsSafely(payload) {
  try {
    const admins = await getDatabase().collection("users")
      .find({ role: "admin", disabled: { $ne: true } }).toArray();
    await writeNotifications({ ...payload, recipients: admins });
  } catch (error) {
    console.error("Could not notify the admin team:", error.message);
  }
}

module.exports = { writeNotifications, notifySafely, notifyAdminsSafely };
