// Admin route guard.
// Expects `Authorization: Bearer <ADMIN_AUTH_TOKEN>` header where the token
// matches the value defined in the server's .env. The token is issued by
// `POST /api/admin-dashboard/login` after username/password verification.
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_AUTH_TOKEN;
  if (!expected) {
    console.error(
      "[requireAdmin] ADMIN_AUTH_TOKEN is not configured in .env — admin endpoints are unreachable.",
    );
    return res
      .status(500)
      .json({ success: false, error: "Admin auth not configured" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token || token !== expected) {
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized" });
  }

  req.adminUser = {
    id: "admin",
    email: process.env.ADMIN_USERNAME || "admin",
    owner: true,
  };

  next();
}

module.exports = { requireAdmin };
