const express = require("express");
const { refundIdentity } = require("../middleware/refundIdentity");

// Banner favorites use the existing native favorites account contract. The
// account UUID is persisted by the app; do not make device migration or email
// login a prerequisite for saving a template. All queries remain account-scoped.
function bannerFavoritesIdentity(db) {
  return async (req, res, next) => {
    const id = req.body?.userId || req.query.userId;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return res.status(400).json({ success: false, error: "INVALID_USER" });
    // When a signed session is supplied, verify that it owns this app account.
    if (req.headers.authorization) return refundIdentity(db)(req, res, () => { req.bannerUserId = req.refundUserId; next(); });
    try {
      const { data, error } = await db.from("users").select("id").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
      req.bannerUserId = data.id;
      next();
    } catch { res.status(500).json({ success: false, error: "FAVORITES_FAILED" }); }
  };
}
function createBannerFavoritesRouter({ db, templates, serialize, identity = bannerFavoritesIdentity(db) }) {
  const router = express.Router();
  const catalog = new Map(templates.map(t => [t.id, t]));
  router.use(identity);
  router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.get("/", async (req, res) => {
    try {
      const { data, error } = await db.from("banner_template_favorites").select("template_id").eq("user_id", req.bannerUserId).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      res.json({ success: true, ids: data.map(r => r.template_id).filter(id => catalog.has(id)) });
    } catch { res.status(500).json({ success: false, error: "FAVORITES_FAILED" }); }
  });
  router.get("/templates", async (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const eligible = templates.filter(t => !req.query.cat || req.query.cat === "all" || t.cat === req.query.cat).map(t => t.id);
    if (!eligible.length) return res.json({ success: true, templates: [], nextOffset: null, total: 0 });
    try {
      const { data, error, count } = await db.from("banner_template_favorites").select("template_id", { count: "exact" }).eq("user_id", req.bannerUserId).in("template_id", eligible).order("created_at", { ascending: false }).order("template_id").range(offset, offset + limit - 1);
      if (error) throw error;
      const page = await Promise.all(data.map(r => serialize(catalog.get(r.template_id), req.query.lang)));
      res.json({ success: true, templates: page, total: count, nextOffset: offset + page.length < count ? offset + page.length : null });
    } catch { res.status(500).json({ success: false, error: "FAVORITES_FAILED" }); }
  });
  router.put("/:templateId", async (req, res) => {
    const { templateId } = req.params;
    if (!catalog.has(templateId)) return res.status(404).json({ success: false, error: "TEMPLATE_NOT_FOUND" });
    if (typeof req.body.favorite !== "boolean") return res.status(400).json({ success: false, error: "INVALID_FAVORITE" });
    try {
      const table = db.from("banner_template_favorites");
      const { error } = req.body.favorite
        ? await table.upsert({ user_id: req.bannerUserId, template_id: templateId }, { onConflict: "user_id,template_id", ignoreDuplicates: true })
        : await table.delete().eq("user_id", req.bannerUserId).eq("template_id", templateId);
      if (error) throw error;
      res.json({ success: true, templateId, favorite: req.body.favorite });
    } catch { res.status(500).json({ success: false, error: "FAVORITE_SAVE_FAILED" }); }
  });
  return router;
}
module.exports = { createBannerFavoritesRouter };
