const RENTAL_TYPES = ["Daily", "Weekly", "Monthly"];
const ROLES = ["customer", "owner", "admin"];
const EQUIPMENT_STATUSES = ["pending", "approved", "rejected"];
const BOOKING_STATUSES = ["pending", "confirmed", "rejected", "completed", "cancelled"];

function rentalUnits(startDate, endDate, rentalType) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const invalidDate = (value, date) =>
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value;
  if (
    invalidDate(startDate, start) ||
    invalidDate(endDate, end) ||
    end < start ||
    !RENTAL_TYPES.includes(rentalType)
  ) {
    const error = new Error("Invalid rental dates or rental type");
    error.status = 400;
    throw error;
  }
  const days = Math.max(1, Math.ceil((end - start) / 86_400_000));
  if (rentalType === "Weekly") return Math.ceil(days / 7);
  if (rentalType === "Monthly") return Math.ceil(days / 30);
  return days;
}

function toPublicDocument(document) {
  if (!document) return document;
  const { _id, passwordHash, ...safeDocument } = document;
  return { ...safeDocument, id: _id?.toString() };
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
}

function equipmentFilter(query) {
  const filter = { status: "approved" };
  const search = String(query.search || query.q || "").trim();
  if (search.length > 100) {
    const error = new Error("Search text must be 100 characters or fewer");
    error.status = 400;
    throw error;
  }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    filter.$or = [{ name: pattern }, { category: pattern }, { location: pattern }];
  }
  if (query.category) filter.category = String(query.category).trim();
  if (query.rentalType) {
    if (!RENTAL_TYPES.includes(query.rentalType)) {
      const error = new Error("Invalid rental type");
      error.status = 400;
      throw error;
    }
    filter.rentalType = query.rentalType;
  }
  if (query.available !== undefined && !["true", "false"].includes(query.available)) {
    const error = new Error("Availability must be true or false");
    error.status = 400;
    throw error;
  }
  if (query.available === "true" || query.available === "false") {
    filter.availableQuantity = query.available === "true" ? { $gt: 0 } : 0;
  }
  const minPrice = query.minPrice === undefined ? undefined : Number(query.minPrice);
  const maxPrice = query.maxPrice === undefined ? undefined : Number(query.maxPrice);
  if (
    (minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) ||
    (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)
  ) {
    const error = new Error("Invalid price range");
    error.status = 400;
    throw error;
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = minPrice;
    if (maxPrice !== undefined) filter.price.$lte = maxPrice;
  }
  return filter;
}

function equipmentSort(sort) {
  if (sort === "price-low") return { price: 1, _id: 1 };
  if (sort === "price-high") return { price: -1, _id: 1 };
  if (sort && sort !== "recent") {
    const error = new Error("Invalid sort order");
    error.status = 400;
    throw error;
  }
  return { createdAt: -1, _id: -1 };
}

module.exports = {
  BOOKING_STATUSES,
  EQUIPMENT_STATUSES,
  RENTAL_TYPES,
  ROLES,
  equipmentFilter,
  equipmentSort,
  pagination,
  rentalUnits,
  toPublicDocument,
};
