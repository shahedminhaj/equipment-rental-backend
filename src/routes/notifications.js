const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, authenticate, parseObjectId } = require("../middleware");
const { writeNotifications } = require("../notifications");

const router = Router();
const USER_ROLES = ["customer", "owner"];

function toInboxItem(item, currentUserId) {
  const direction = item.senderId.equals(currentUserId) ? "sent" : "received";
  return {
    id: item._id.toString(),
    messageId: (item.messageId || item._id).toString(),
    type: item.type || "message",
    direction,
    senderName: item.senderName,
    senderRole: item.senderRole,
    recipientName: direction === "sent" && item.senderRole !== "admin" && item.recipientRole === "admin"
      ? "Admin team" : item.recipientName || (item.recipientRole === "admin" ? "Admin team" : "User"),
    recipientRole: item.recipientRole,
    subject: item.subject,
    message: item.message,
    createdAt: item.createdAt,
    readAt: direction === "sent" ? item.createdAt : item.readAt || null,
  };
}

router.get("/mine", authenticate, asyncHandler(async (request, response) => {
  const limitValue = Number.parseInt(request.query.limit, 10);
  const limit = Number.isInteger(limitValue) ? Math.min(50, Math.max(1, limitValue)) : 30;
  const notifications = getDatabase().collection("notifications");
  const [items, unreadCount] = await Promise.all([
    notifications.find({ $or: [
      { recipientId: request.user._id },
      { senderId: request.user._id, type: "message" },
    ] }).sort({ createdAt: -1, _id: -1 }).limit(Math.min(limit * 10, 500)).toArray(),
    notifications.countDocuments({ recipientId: request.user._id, readAt: null }),
  ]);
  const sentMessages = new Set();
  const uniqueItems = items.filter((item) => {
    if (!item.senderId.equals(request.user._id)) return true;
    const messageId = (item.messageId || item._id).toString();
    if (sentMessages.has(messageId)) return false;
    sentMessages.add(messageId);
    return true;
  }).slice(0, limit).map((item) => toInboxItem(item, request.user._id));
  response.json({ items: uniqueItems, unreadCount });
}));

router.patch("/read-all", authenticate, asyncHandler(async (request, response) => {
  const result = await getDatabase().collection("notifications").updateMany(
    { recipientId: request.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  response.json({ updated: result.modifiedCount });
}));

router.post("/", authenticate, asyncHandler(async (request, response) => {
  const subject = typeof request.body?.subject === "string" ? request.body.subject.trim() : "";
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  if (subject.length < 3 || subject.length > 100 || message.length < 2 || message.length > 1500) {
    return response.status(400).json({ message: "Subject must be 3-100 characters and message 2-1500 characters" });
  }

  const db = getDatabase();
  const now = new Date();
  const recentCount = await db.collection("notifications").countDocuments({
    senderId: request.user._id,
    type: "message",
    createdAt: { $gte: new Date(now.getTime() - 60_000) },
  });
  if (recentCount >= 10) return response.status(429).json({ message: "Please wait before sending more messages" });

  let recipients;
  if (request.user.role === "admin") {
    let recipientId;
    try {
      recipientId = parseObjectId(request.body?.recipientId, "recipient id");
    } catch (error) {
      return response.status(400).json({ message: error.message });
    }
    const recipient = await db.collection("users").findOne({
      _id: recipientId,
      role: { $in: USER_ROLES },
      disabled: { $ne: true },
    }, { projection: { name: 1, role: 1 } });
    if (!recipient) return response.status(404).json({ message: "Choose an active customer or owner" });
    recipients = [recipient];
  } else if (USER_ROLES.includes(request.user.role)) {
    recipients = await db.collection("users").find(
      { role: "admin", disabled: { $ne: true } },
      { projection: { name: 1, role: 1 } },
    ).toArray();
    if (!recipients.length) return response.status(503).json({ message: "The admin team is not available to receive messages yet" });
  } else {
    return response.status(403).json({ message: "Only customers, owners, and admins can send messages" });
  }

  const rows = await writeNotifications({ sender: request.user, recipients, subject, message, type: "message", createdAt: now });
  return response.status(201).json({ notification: toInboxItem(rows[0], request.user._id) });
}));

module.exports = router;
