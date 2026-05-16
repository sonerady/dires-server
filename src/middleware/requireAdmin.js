// Admin route guard.
// 1) Extracts Bearer token from Authorization header.
// 2) Verifies the JWT against Supabase Auth (`auth.getUser`).
// 3) Looks up the matching row in `public.users` by `supabase_user_id`.
// 4) Allows the request only if `owner === true`.
// 5) Attaches `req.adminUser = { id, email, owner }` for downstream handlers.
const { supabase, supabaseAdmin } = require("../supabaseClient");

const db = supabaseAdmin || supabase;

async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "Missing Bearer token" });
    }

    // Verify the token with Supabase (uses anon client — Supabase validates the JWT signature)
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    }

    const supabaseUserId = authData.user.id;

    const { data: dbUser, error: dbError } = await db
      .from("users")
      .select("id, email, owner")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (dbError || !dbUser) {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    if (dbUser.owner !== true) {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    req.adminUser = {
      id: dbUser.id,
      email: dbUser.email,
      owner: true,
      supabase_user_id: supabaseUserId,
    };

    next();
  } catch (err) {
    console.error("[requireAdmin] Unexpected error:", err);
    res.status(500).json({ success: false, error: "Admin auth failed" });
  }
}

module.exports = { requireAdmin };
