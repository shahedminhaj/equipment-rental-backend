const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const config = require("./config");
const { getDatabase } = require("./db");

function asyncHandler(handler) {
  return function wrappedHandler(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function verifyToken(request, response, next) {
  const authorization = request.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ message: "Authentication required" });
  }
  try {
    request.auth = jwt.verify(token, config.jwtSecret);
  } catch {
    return response.status(401).json({ message: "Invalid or expired token" });
  }
  return next();
}

async function loadCurrentUser(request, response, next) {
  try {
    const user = await getDatabase().collection("users").findOne({
      _id: new ObjectId(request.auth.sub),
      disabled: { $ne: true },
    });
    if (!user) return response.status(401).json({ message: "User account not found" });
    request.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRoles(...roles) {
  return function roleGuard(request, response, next) {
    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ message: "You do not have permission to do this" });
    }
    return next();
  };
}

const authenticate = [verifyToken, loadCurrentUser];
const verifyRenter = [...authenticate, requireRoles("customer")];
const verifyOwner = [...authenticate, requireRoles("owner")];
const verifyAdmin = [...authenticate, requireRoles("admin")];

function parseObjectId(value, label = "id") {
  if (!ObjectId.isValid(value) || String(new ObjectId(value)) !== value) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
  return new ObjectId(value);
}

module.exports = {
  asyncHandler,
  authenticate,
  parseObjectId,
  requireRoles,
  verifyAdmin,
  verifyOwner,
  verifyRenter,
  verifyToken,
};
