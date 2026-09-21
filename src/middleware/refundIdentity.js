const { createHash, timingSafeEqual } = require("node:crypto");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length >= 16 &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Native anonymous accounts keep their existing device identity; email login is not required.
function refundIdentity(db) {
  return async (req, res, next) => {
    try {
      const id = req.body?.userId || req.query.userId;
      if (!/^[0-9a-f-]{36}$/i.test(id || ""))
        return res.status(400).json({ success: false, reason: "invalid_user" });
      const { data: user, error } = await db
        .from("users")
        .select("id,supabase_user_id,device_id")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      const token = String(req.headers.authorization || "").replace(
        /^Bearer /,
        "",
      );
      let verified = false;
      if (token.includes(".")) {
        const { data, error: authError } = await db.auth.getUser(token);
        verified =
          !authError && !!data?.user && user?.supabase_user_id === data.user.id;
      } else if (/^[a-f0-9]{64}$/i.test(token)) {
        const { data } = await db
          .from("acquisition_push_enrollments")
          .select("token_hash")
          .eq("user_id", id)
          .maybeSingle();
        verified = equal(
          createHash("sha256").update(token).digest("hex"),
          data?.token_hash,
        );
      }
      // Existing installations predate signed device sessions. A UUID alone is never enough.
      if (!verified)
        verified = equal(req.headers["x-device-id"], user?.device_id);
      if (!verified)
        return res
          .status(401)
          .json({ success: false, reason: "identity_required" });
      req.refundUserId = id;
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { refundIdentity, equal };
