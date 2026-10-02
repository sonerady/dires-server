// 🧩 Kolaj planlayıcı — doğrulayıcı, yedek plan, model orkestrasyonu ve uç (30 Eyl 2026)
// Çalıştır: node --test tests/collagePlan.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const planner = require("../src/utils/collagePlanner");
const { createCollagePlanRouter } = require("../src/routes/collagePlanRoutes");

const { core } = planner;
const SUPA = "https://abc.supabase.co/storage/v1/object/public/images/collagePlan/p.jpg";
const photos = [
  { width: 1600, height: 1200, plain: true, bbox: [0.2, 0.25, 0.8, 0.75], bg: "#FAFAFA", avg: "#C8141E", url: SUPA },
  { width: 1200, height: 1600, url: SUPA },
  { width: 1000, height: 1000, url: SUPA },
];
const brief = (extra = {}) => core.validateBrief({ photos, language: "tr", ...extra });
const aiPlan = (extra = {}) => ({
  templateId: "h3-left", ratio: "4:5", order: [2, 0, 1], heroIndex: 2,
  cells: [{ photoIndex: 0, focusX: 0.5, focusY: 0.5, zoom: 1.4 }, { photoIndex: 1, focusX: 0.4, focusY: 0.6, zoom: 1 }, { photoIndex: 2, focusX: 0.5, focusY: 0.5, zoom: 1 }],
  gap: 2, margin: 4, radius: 3, background: "#F3EDE4",
  caption: { title: "Yeni sezon", subtitle: "Mağazada", align: "center", color: "#111111", position: "bottom", font: "elegant" },
  labels: false, purpose: "lookbook", reason: "Geniş fotoğraf büyük hücrede.",
  ...extra,
});

test("brief: unknown values fall back to auto; auto mode ignores manual fields; photos capped at 9", () => {
  const b = core.validateBrief({ mode: "auto", purpose: "story", ratio: "2:1", brandColor: "#123456", heroIndex: 1, photos: Array.from({ length: 14 }, () => ({ width: 10, height: 10 })) });
  assert.equal(b.purpose, "auto");
  assert.equal(b.ratio, "auto");
  assert.equal(b.brandColor, null);
  assert.equal(b.heroIndex, null);
  assert.equal(b.photos.length, 9);
  const m = core.validateBrief({ mode: "manual", purpose: "story", ratio: "2:1", mood: "loud", brandColor: "abc", heroIndex: 7, photos, caption: { mode: "custom", title: "  Yeni\u0007  sezon  ", subtitle: "x".repeat(200) } });
  assert.equal(m.purpose, "story");
  assert.equal(m.ratio, "auto");
  assert.equal(m.mood, "auto");
  assert.equal(m.brandColor, "#AABBCC");
  assert.equal(m.heroIndex, null, "hero index outside the photo list is ignored");
  assert.equal(m.caption.title, "Yeni sezon");
  assert.equal(m.caption.subtitle.length, 90);
  assert.equal(core.validateBrief({ photos: [{ url: "http://insecure.example/x.jpg" }] }).photos[0].url, null);
});

test("fallback plan is deterministic, valid and honours purpose profiles", () => {
  const a = core.fallbackPlan(brief());
  const b = core.fallbackPlan(brief());
  assert.deepEqual(a, b);
  assert.equal(core.templateById(a.templateId).count, 3);
  assert.deepEqual([...a.order].sort(), [0, 1, 2]);
  const { issues } = core.validatePlan(a, brief());
  assert.deepEqual(issues, [], "the fallback plan passes the strict validator unchanged");
  const market = core.fallbackPlan(brief({ mode: "manual", purpose: "marketplace" }));
  assert.equal(market.ratio, "1:1");
  assert.equal(market.background, "#FFFFFF");
  const ba = core.fallbackPlan(core.validateBrief({ mode: "manual", purpose: "before_after", photos: photos.slice(0, 2) }));
  assert.equal(core.templateById(ba.templateId).family, "split");
  assert.equal(ba.labels, true);
});

test("strict validator: unusable plans throw, broken fields are repaired and reported", () => {
  assert.throws(() => core.validatePlan(null, brief()), /plan_not_object/);
  assert.throws(() => core.validatePlan(aiPlan({ templateId: "g4" }), brief()), /plan_template/);
  assert.throws(() => core.validatePlan(aiPlan({ templateId: "nope" }), brief()), /plan_template/);
  assert.throws(() => core.validatePlan(aiPlan({ order: [0, 0, 1] }), brief()), /plan_order/);
  assert.throws(() => core.validatePlan(aiPlan({ order: [0, 1] }), brief()), /plan_order/);
  const { plan, issues } = core.validatePlan(aiPlan({ gap: 99, background: "red", ratio: "5:4", caption: { title: "Hi", color: "#F3EDE4", align: "middle" }, cells: [{ photoIndex: 9 }] }), brief());
  assert.equal(plan.gap, 8);
  assert.match(plan.background, /^#[0-9A-F]{6}$/);
  assert.ok(["1:1", "4:5", "3:4", "9:16", "16:9"].includes(plan.ratio));
  assert.equal(plan.caption.align, "center");
  assert.notEqual(plan.caption.color, "#F3EDE4", "unreadable text colour is replaced");
  assert.equal(plan.cells.length, 3);
  for (const field of ["gap", "background", "ratio", "caption.align", "caption.color", "cells"]) assert.ok(issues.includes(field), field);
  const ok = core.validatePlan(aiPlan(), brief());
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.plan.caption.title, "Yeni sezon");
});

test("explicit seller values always win over the model", () => {
  const b = brief({ mode: "manual", ratio: "9:16", heroIndex: 1, brandColor: "#E11D48", caption: { mode: "custom", title: "Benim yazım", subtitle: "" } });
  const { plan } = core.validatePlan(aiPlan(), b);
  assert.equal(plan.ratio, "9:16");
  assert.equal(plan.caption.title, "Benim yazım");
  assert.equal(plan.caption.subtitle, "");
  const heroSlot = core.heroSlot(core.templateById(plan.templateId));
  assert.equal(plan.order[heroSlot], 1);
  assert.equal(plan.heroIndex, 1);
  assert.ok(plan.caption.color === "#E11D48" || plan.background !== "#F3EDE4", "brand colour is used");
  const none = core.validatePlan(aiPlan(), brief({ caption: { mode: "none" } })).plan;
  assert.equal(none.caption, null);
});

test("orchestrator: valid answer → ai; bad JSON retried with the reason; persistent failure → fallback", async () => {
  const calls = [];
  const good = await planner.planCollage({ brief: brief(), ask: async (o) => { calls.push(o); return JSON.stringify(aiPlan()); } });
  assert.equal(good.source, "ai");
  assert.equal(good.plan.templateId, "h3-left");
  assert.equal(calls[0].imageUrls.length, 3, "vision: one preview per photo");
  assert.match(calls[0].prompt, /h3-left/);
  assert.doesNotMatch(calls[0].prompt, /\bg4\b/, "only templates for this photo count are offered");
  assert.match(calls[0].prompt, /language "tr"/);

  const prompts = [];
  const retried = await planner.planCollage({ brief: brief(), ask: async ({ prompt }) => { prompts.push(prompt); return prompts.length === 1 ? "```json\n{ broken" : `Here you go: ${JSON.stringify(aiPlan())}`; } });
  assert.equal(retried.source, "ai");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous answer was rejected/);

  const bad = await planner.planCollage({ brief: brief(), ask: async () => JSON.stringify(aiPlan({ order: [1, 1, 1] })) });
  assert.equal(bad.source, "fallback");
  assert.deepEqual(bad.plan, core.fallbackPlan(brief()));

  const down = await planner.planCollage({ brief: brief(), ask: async () => { throw new Error("fal timeout"); } });
  assert.equal(down.source, "fallback");

  let t = 0;
  const slow = await planner.planCollage({ brief: brief(), now: () => t, budgetMs: 1000, ask: async () => { t += 900; return "nope"; } });
  assert.equal(slow.source, "fallback", "no second attempt once the time budget is spent");

  const noImages = [];
  await planner.planCollage({ brief: core.validateBrief({ photos: [{ width: 10, height: 10 }, { width: 10, height: 10, url: SUPA }] }), ask: async (o) => { noImages.push(o.imageUrls.length); return JSON.stringify(aiPlan({ templateId: "g2-cols", order: [0, 1], cells: [] })); } });
  assert.deepEqual(noImages, [0], "images are only sent when every photo has one (index mapping)");
});

test("image hosts: only our storage over https", () => {
  assert.ok(planner.isAllowedImageUrl(SUPA));
  assert.ok(planner.isAllowedImageUrl("https://api.diress.ai/storage/v1/object/public/images/a.jpg"));
  assert.ok(!planner.isAllowedImageUrl("http://abc.supabase.co/a.jpg"));
  assert.ok(!planner.isAllowedImageUrl("https://evil.example/a.jpg"));
  assert.ok(!planner.isAllowedImageUrl("https://abc.supabase.co.evil.example/a.jpg"));
});

// ─── HTTP ucu (sahte db / kimlik / model) ───────────────────────────
async function withServer({ users, limits, ask }, run) {
  const db = { from: () => { let id; const q = { select: () => q, eq: (_k, v) => { id = v; return q; }, maybeSingle: async () => ({ data: users[id] || null, error: null }) }; return q; } };
  const identity = (req, res, next) => { req.refundUserId = req.body?.userId; next(); };
  const seen = [];
  const fakePlanner = { ...planner, planCollage: (o) => planner.planCollage({ ...o, ask: async (x) => { seen.push(x); return ask(x); } }) };
  const app = express();
  app.use(express.json());
  app.use("/api/collage", createCollagePlanRouter({ db, identity, planner: fakePlanner, limits }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/collage/plan`;
  const post = async (body) => { const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  try { await run(post, seen); } finally { await new Promise((r) => server.close(r)); }
}

test("route: photo minimum, credit gate (PRO or credits, never charged), foreign images dropped, per-user rate limit", async () => {
  const users = { pro: { is_pro: true, credit_balance: 0 }, credits: { is_pro: false, credit_balance: 4 }, free: { is_pro: false, credit_balance: 0 } };
  await withServer({ users, limits: { perMinute: 3, perDay: 100 }, ask: async () => JSON.stringify(aiPlan()) }, async (post, seen) => {
    const rawPhotos = photos.map((p) => ({ ...p }));
    assert.equal((await post({ userId: "pro", brief: { photos: rawPhotos.slice(0, 1) } })).status, 400);
    const free = await post({ userId: "free", brief: { photos: rawPhotos } });
    assert.equal(free.status, 403);
    assert.equal(free.data.reason, "pro_required");
    const ok = await post({ userId: "credits", brief: { photos: rawPhotos, language: "tr" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.source, "ai");
    assert.equal(ok.data.plan.templateId, "h3-left");
    const foreign = rawPhotos.map((p, i) => (i === 1 ? { ...p, url: "https://evil.example/x.jpg" } : p));
    assert.equal((await post({ userId: "pro", brief: { photos: foreign } })).status, 200);
    assert.equal(seen[seen.length - 1].imageUrls.length, 0);
    assert.equal((await post({ userId: "pro", brief: { photos: rawPhotos } })).status, 200);
    const limited = await post({ userId: "pro", brief: { photos: rawPhotos } });
    assert.equal(limited.status, 429);
    assert.equal(limited.data.reason, "rate_limited");
    assert.equal((await post({ userId: "credits", brief: { photos: rawPhotos } })).status, 200, "limits are per user");
  });
});
