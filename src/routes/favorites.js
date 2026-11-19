const { Router } = require("express");
const { getDatabase } = require("../db");
const { asyncHandler, parseObjectId, verifyRenter } = require("../middleware");
const { toPublicDocument } = require("../domain");

const router = Router();

router.get("/", verifyRenter, asyncHandler(async (request, response) => {
  const favorites = await getDatabase().collection("favorites")
    .find({ userId: request.user._id })
    .sort({ createdAt: -1 })
    .toArray();
  const ids = favorites.map((favorite) => favorite.equipmentId);
  const items = ids.length
    ? await getDatabase().collection("equipment")
      .find({ _id: { $in: ids } })
      .toArray()
    : [];
  const byId = new Map(items.map((item) => [item._id.toString(), item]));
  response.json({
    items: favorites.map((favorite) => ({
      favoriteId: favorite._id.toString(),
      equipment: toPublicDocument(byId.get(favorite.equipmentId.toString()) || null),
    })).filter((favorite) => favorite.equipment),
  });
}));

router.post("/:equipmentId", verifyRenter, asyncHandler(async (request, response) => {
  const equipmentId = parseObjectId(request.params.equipmentId, "equipment id");
  const equipment = await getDatabase().collection("equipment").findOne({
    _id: equipmentId,
    status: "approved",
  });
  if (!equipment) return response.status(404).json({ message: "Equipment not found" });
  await getDatabase().collection("favorites").updateOne(
    { userId: request.user._id, equipmentId },
    { $setOnInsert: { userId: request.user._id, equipmentId, createdAt: new Date() } },
    { upsert: true },
  );
  response.status(201).json({ message: "Added to favorites" });
}));

router.delete("/:equipmentId", verifyRenter, asyncHandler(async (request, response) => {
  const equipmentId = parseObjectId(request.params.equipmentId, "equipment id");
  const result = await getDatabase().collection("favorites").deleteOne({
    userId: request.user._id,
    equipmentId,
  });
  if (!result.deletedCount) return response.status(404).json({ message: "Favorite not found" });
  response.status(204).end();
}));

module.exports = router;
