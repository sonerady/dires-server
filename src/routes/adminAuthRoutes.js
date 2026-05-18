// Public admin auth router — mounted BEFORE requireAdmin so /login is reachable.
// Validates username + password against process.env and hands back the shared
// ADMIN_AUTH_TOKEN. Trivial setup intended for a single-operator dashboard;
// rotate the token in .env to invalidate previously-issued sessions.
const express = require("express");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  const token = process.env.ADMIN_AUTH_TOKEN;

  if (!expectedUser || !expectedPass || !token) {
    return res
      .status(500)
      .json({ success: false, error: "Admin credentials not configured" });
  }

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim() !== expectedUser ||
    password !== expectedPass
  ) {
    return res
      .status(401)
      .json({ success: false, error: "Invalid username or password" });
  }

  res.json({
    success: true,
    token,
    user: { id: "admin", email: expectedUser, owner: true },
  });
});

module.exports = router;
