// 📤 Kullanıcı çıktıları — doğrulama (meta, depolama adresi), kimlik, not_ready, hız sınırı, admin liste/istatistik
// Çalıştır: node --test tests/userExports.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createUserExportRouter, core } = require("../src/routes/userExportRoutes");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const HOST = "store.example.test";
const url = (p) => `https://${HOST}/storage/v1/object/public/images/${p}`;
const hosts = new Set([HOST]);

/** Supabase sorgu zinciri taklidi: her çağrı kaydedilir, await edilince handler(table, ops) yanıtı döner. */
function fakeDb(handler) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const ops = [];
      calls.push({ table, ops });
      const q = new Proxy({}, {
        get(_, name) {
          if (name === "then") return (resolve, reject) => Promise.resolve().then(() => handler(table, ops)).then(resolve, reject);
          return (...args) => { ops.push([name, ...args]); return q; };
        },
      });
      return q;
    },
    storage: {
      uploads: [],
      from(bucket) {
        return {
          upload: async (path, buf, opts) => { db.storage.uploads.push({ bucket, path, size: buf.length, opts }); return { error: null }; },
          getPublicUrl: (path) => ({ data: { publicUrl: url(path) } }),
        };
      },
    },
  };
  return db;
}
const op = (ops, name) => ops.find((o) => o[0] === name);

const identity = (req, res, next) => {
  const id = req.body?.userId || req.query.userId;
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return res.status(400).json({ success: false, reason: "invalid_user" });
  if (req.headers["x-device-id"] !== `device-${id}`) return res.status(401).json({ success: false, reason: "identity_required" });
  req.refundUserId = id;
  next();
};
const requireAdmin = (req, res, next) => (req.headers.authorization === "Bearer admin-token" ? next() : res.status(401).json({ success: false, error: "Unauthorized" }));

async function serve({ handler = () => ({ data: null, error: null }), limits, fileToolsValue } = {}) {
  const db = fakeDb(handler);
  const app = express();
  app.use(express.json());
  app.use("/api", createUserExportRouter({ db, identity, requireAdmin, limits, hosts: [...hosts], fileToolsValue }));
  app.get("/api/other", (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (body, { user = A, device } = {}) => {
    const r = await fetch(`${base}/exports/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": device === undefined ? `device-${user}` : device },
      body: JSON.stringify({ userId: user, ...body }),
    });
    return { status: r.status, data: await r.json() };
  };
  const get = async (path, token = "admin-token") => {
    const r = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, data: await r.json() };
  };
  return { db, base, post, get, close: () => new Promise((r) => server.close(r)) };
}

test("validateMeta: known keys kept with strict types, unknown keys dropped, control chars stripped", () => {
  const ok = core.validateMeta({ template: "grid-4", photo_count: 4, batch: true, app_version: "1.9.0", secret: "x", caption: "hello" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.meta, { template: "grid-4", photo_count: 4, batch: true, app_version: "1.9.0" });
  assert.equal(ok.dropped, 2);
  assert.deepEqual(core.validateMeta(null), { ok: true, meta: {} });
  assert.equal(core.validateMeta([]).ok, false);
  assert.equal(core.validateMeta("x").ok, false);
  assert.deepEqual(core.validateMeta({ photo_count: "4" }), { ok: false, reason: "invalid_meta", field: "photo_count" });
  assert.deepEqual(core.validateMeta({ photo_count: 2.5 }), { ok: false, reason: "invalid_meta", field: "photo_count" });
  assert.deepEqual(core.validateMeta({ batch: "yes" }), { ok: false, reason: "invalid_meta", field: "batch" });
  assert.deepEqual(core.validateMeta({ template: { a: 1 } }), { ok: false, reason: "invalid_meta", field: "template" });
  assert.deepEqual(core.validateMeta({ template: "x".repeat(81) }), { ok: false, reason: "invalid_meta", field: "template" });
  assert.deepEqual(core.validateMeta({ film: "Port\u0000ra‮ 400" }).meta, { film: "Port ra 400" });
});

test("validateStorageUrl: only our storage host, https, the tool's userExports folder and the right extension", () => {
  const v = (value, tool = "collage", kind = "file") => core.validateStorageUrl(value, { tool, kind, hosts });
  assert.deepEqual(v(url("userExports/collage/1_abc.jpg")), { ok: true, url: url("userExports/collage/1_abc.jpg") });
  assert.deepEqual(v(undefined), { ok: true, url: null });
  assert.equal(v(url("userExports/catalog_pdf/x.pdf"), "catalog_pdf").ok, true);
  assert.equal(v(url("userExports/catalog_pdf/x.jpg"), "catalog_pdf", "thumb").ok, true);
  assert.equal(v(url("userExports/catalog_pdf/x.jpg"), "catalog_pdf").ok, false, "PDF tool file must be a .pdf");
  assert.equal(v(url("userExports/film_lab/x.pdf"), "film_lab").ok, false);
  assert.equal(v(url("userExports/film_lab/x.jpg"), "collage").ok, false, "another tool's folder");
  assert.equal(v(url("uploads/x.jpg")).ok, false, "outside userExports");
  assert.equal(v(url("userExports/collage/")).ok, false);
  assert.equal(v(url("userExports/collage/../../reference/x.jpg")).ok, false);
  assert.equal(v(url("userExports/collage/%2e%2e/x.jpg")).ok, false);
  assert.equal(v(url("userExports/collage/a.jpg") + "?x=1").ok, false);
  assert.equal(v(url("userExports/collage/a.jpg") + "#x").ok, false);
  assert.equal(v(url("userExports/collage/a.jpg").replace("https:", "http:")).ok, false);
  assert.equal(v(url("userExports/collage/a.jpg").replace(HOST, "evil.example")).ok, false);
  assert.equal(v(url("userExports/collage/a.jpg").replace(HOST, `${HOST}.evil.example`)).ok, false);
  assert.equal(v(url("userExports/collage/a.jpg").replace(HOST, `user@${HOST}`)).ok, false);
  assert.equal(v(url("userExports/collage/a.jpg").replace(HOST, `${HOST}:8443`)).ok, false);
  assert.equal(v("javascript:alert(1)").ok, false);
  assert.equal(v(42).ok, false);
  assert.equal(v(url("userExports/collage/" + "a".repeat(600) + ".jpg")).ok, false);
  assert.equal(v(url("bannerStudio/downloads/x.jpg"), "banner").ok, true, "banner may point at its existing folder");
  assert.equal(v(url("bannerStudio/downloads/x.jpg"), "collage").ok, false);
});

test("fileTools: all by default, none, or a list; dayRange is Istanbul-day based and clamped", () => {
  assert.deepEqual([...core.fileTools(undefined)].sort(), [...core.TOOLS].sort());
  assert.equal(core.fileTools("none").size, 0);
  assert.deepEqual([...core.fileTools("collage, catalog_pdf,bogus")], ["collage", "catalog_pdf"]);
  const r = core.dayRange({ from: "2026-09-01", to: "2026-09-03" });
  assert.equal(r.fromIso, "2026-08-31T21:00:00.000Z");
  assert.equal(r.toIso, "2026-09-03T21:00:00.000Z");
  const swapped = core.dayRange({ from: "2026-09-03", to: "2026-09-01" });
  assert.equal(swapped.from, "2026-09-01");
  const clamped = core.dayRange({ from: "2020-01-01", to: "2026-09-30" }, { maxDays: 10 });
  assert.equal(clamped.from, "2026-09-21");
  assert.equal(core.localDay("2026-09-30T21:30:00Z"), "2026-10-01");
});

test("record: identity required; valid meta inserted under the verified user; upload flag follows the switch", async () => {
  const inserts = [];
  const s = await serve({ handler: (table, ops) => { if (op(ops, "insert")) inserts.push(op(ops, "insert")[1]); return { data: null, error: null }; } });
  try {
    assert.equal((await s.post({ tool: "collage" }, { device: "" })).status, 401);
    assert.equal((await s.post({ tool: "collage" }, { user: "nope" })).status, 400);
    assert.equal((await s.post({ tool: "video" })).data.reason, "invalid_tool");
    assert.equal((await s.post({ tool: "collage", meta: { photo_count: "4" } })).data.reason, "invalid_meta");
    assert.equal((await s.post({ tool: "collage", fileUrl: "https://evil.example/x.jpg" })).data.reason, "invalid_url");
    const ok = await s.post({ tool: "collage", meta: { template: "grid-4", photo_count: 4, platform: "ios", note: "dropped" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.success, true);
    assert.match(ok.data.id, /^[0-9a-f-]{36}$/);
    assert.equal(ok.data.upload, true);
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0], { id: ok.data.id, user_id: A, tool: "collage", file_url: null, thumb_url: null, meta: { template: "grid-4", photo_count: 4, platform: "ios" } });
  } finally { await s.close(); }
  const off = await serve({ fileToolsValue: "catalog_pdf" });
  try {
    assert.equal((await off.post({ tool: "film_lab" })).data.upload, false, "film_lab files switched off");
    assert.equal((await off.post({ tool: "catalog_pdf" })).data.upload, true);
  } finally { await off.close(); }
});

test("record attach: only the caller's own row, only once, only valid storage URLs", async () => {
  let found = true;
  const s = await serve({ handler: (table, ops) => (op(ops, "update") ? { data: found ? [{ id: "x" }] : [], error: null } : { data: null, error: null }) });
  try {
    const id = "33333333-3333-4333-8333-333333333333";
    assert.equal((await s.post({ tool: "collage", id: "bad" })).data.reason, "invalid_id");
    assert.equal((await s.post({ tool: "collage", id })).data.reason, "invalid_url", "nothing to attach");
    const ok = await s.post({ tool: "collage", id, fileUrl: url("userExports/collage/a.jpg"), thumbUrl: url("userExports/collage/a_t.jpg") });
    assert.equal(ok.data.success, true);
    const call = s.db.calls.find((c) => op(c.ops, "update"));
    assert.deepEqual(op(call.ops, "update")[1], { file_url: url("userExports/collage/a.jpg"), thumb_url: url("userExports/collage/a_t.jpg") });
    const eqs = call.ops.filter((o) => o[0] === "eq").map((o) => [o[1], o[2]]);
    assert.deepEqual(eqs, [["id", id], ["user_id", A], ["tool", "collage"]]);
    assert.deepEqual(op(call.ops, "is"), ["is", "file_url", null]);
    found = false;
    assert.equal((await s.post({ tool: "collage", id, fileUrl: url("userExports/collage/a.jpg") })).status, 404);
  } finally { await s.close(); }
});

test("record: missing table → 200 not_ready (never 500); other DB errors → 500 without details", async () => {
  let error = { code: "PGRST205", message: "Could not find the table 'public.user_exports' in the schema cache" };
  const s = await serve({ handler: () => ({ data: null, error }) });
  try {
    const r = await s.post({ tool: "film_lab", meta: { film: "portra" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { success: false, reason: "not_ready" });
    error = { code: "42P01", message: 'relation "user_exports" does not exist' };
    assert.equal((await s.post({ tool: "film_lab" })).data.reason, "not_ready");
    error = { code: "08006", message: "connection failure secret-host" };
    const fail = await s.post({ tool: "film_lab" });
    assert.equal(fail.status, 500);
    assert.deepEqual(fail.data, { success: false, reason: "request_failed" });
  } finally { await s.close(); }
});

test("record: per-user rate limit → 429 rate_limited; the router does not touch other /api routes", async () => {
  const s = await serve({ limits: { recordPerTenMin: 2 } });
  try {
    assert.equal((await s.post({ tool: "collage" })).status, 200);
    assert.equal((await s.post({ tool: "collage" })).status, 200);
    const r = await s.post({ tool: "collage" });
    assert.equal(r.status, 429);
    assert.equal(r.data.reason, "rate_limited");
    assert.equal((await s.post({ tool: "collage" }, { user: B })).status, 200, "another user is not limited");
    const other = await fetch(`${s.base}/other`);
    assert.equal(other.status, 200);
    assert.equal(other.headers.get("cache-control"), null);
  } finally { await s.close(); }
});

test("upload: PDF only (magic bytes), identity first, stored under userExports/catalog_pdf with application/pdf", async () => {
  const s = await serve();
  try {
    const send = async (bytes, { tool = "catalog_pdf", user = A, device = `device-${A}` } = {}) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "application/pdf" }), "c.pdf");
      const r = await fetch(`${s.base}/exports/upload?userId=${user}&tool=${tool}`, { method: "POST", headers: { "X-Device-Id": device }, body: form });
      return { status: r.status, data: await r.json() };
    };
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
    assert.equal((await send(pdf, { device: "wrong" })).status, 401);
    assert.equal((await send(pdf, { tool: "collage" })).data.reason, "invalid_tool");
    assert.equal((await send(Buffer.alloc(300, 65))).data.reason, "invalid_file");
    const ok = await send(pdf);
    assert.equal(ok.data.success, true);
    assert.match(ok.data.url, new RegExp(`^https://${HOST}/storage/v1/object/public/images/userExports/catalog_pdf/[0-9a-f-]{36}\\.pdf$`));
    assert.equal(s.db.storage.uploads.length, 1);
    assert.equal(s.db.storage.uploads[0].opts.contentType, "application/pdf");
    // the returned URL passes the record validator
    assert.equal(core.validateStorageUrl(ok.data.url, { tool: "catalog_pdf", kind: "file", hosts }).ok, true);
  } finally { await s.close(); }
  const off = await serve({ fileToolsValue: "none" });
  try {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")]), "c.pdf");
    const r = await fetch(`${off.base}/exports/upload?userId=${A}&tool=catalog_pdf`, { method: "POST", headers: { "X-Device-Id": `device-${A}` }, body: form });
    assert.equal((await r.json()).reason, "disabled");
    assert.equal(off.db.storage.uploads.length, 0);
  } finally { await off.close(); }
});

const exportRows = [
  { id: "e1", user_id: A, tool: "collage", file_url: url("userExports/collage/1.jpg"), thumb_url: url("userExports/collage/1t.jpg"), meta: { template: "grid-4" }, created_at: "2026-09-30T10:00:00.000Z" },
  { id: "e2", user_id: B, tool: "catalog_pdf", file_url: url("userExports/catalog_pdf/2.pdf"), thumb_url: null, meta: { page_count: 6 }, created_at: "2026-09-30T08:00:00.000Z" },
];
const bannerRows = [
  { id: "b1", user_id: A, template_id: "sale-1", template_name: "Sale", category: "sale", format: "image", action: "save", mode: "still", result_id: null, file_url: url("bannerStudio/downloads/b1.jpg"), ratio_value: 0.8, language: "tr", is_sample_photo: false, created_at: "2026-09-30T09:00:00.000Z" },
  { id: "b2", user_id: "anonymous_user", template_id: "sale-2", template_name: "Sale 2", category: "sale", format: "image", action: "save", mode: "still", result_id: "44444444-4444-4444-8444-444444444444", file_url: null, ratio_value: 1, language: "en", is_sample_photo: false, created_at: "2026-09-29T09:00:00.000Z" },
];
function adminHandler({ missingExports = false, missingBanners = false } = {}) {
  return (table, ops) => {
    if (table === "users") {
      if (op(ops, "ilike")) return { data: [{ id: A }], error: null };
      return { data: [{ id: A, email: "a@example.com", is_pro: true, platform: "ios", app_version: "1.9.0" }], error: null };
    }
    if (table === "user_exports") {
      if (missingExports) return { data: null, count: null, error: { code: "PGRST205", message: "Could not find the table 'public.user_exports' in the schema cache" } };
      let rows = exportRows;
      const tool = ops.find((o) => o[0] === "eq" && o[1] === "tool");
      if (tool) rows = rows.filter((r) => r.tool === tool[2]);
      const inUser = op(ops, "in");
      if (inUser) rows = rows.filter((r) => inUser[2].includes(r.user_id));
      const range = op(ops, "range");
      return { data: rows.slice(range[1], range[2] + 1), count: rows.length, error: null };
    }
    if (table === "banner_gallery_downloads") {
      if (missingBanners) return { data: null, count: null, error: { code: "42P01", message: 'relation "banner_gallery_downloads" does not exist' } };
      let rows = bannerRows;
      const inUser = op(ops, "in");
      if (inUser) rows = rows.filter((r) => inUser[2].includes(r.user_id));
      const range = op(ops, "range");
      return { data: rows.slice(range[1], range[2] + 1), count: rows.length, error: null };
    }
    if (table === "banner_studio_results") return { data: [{ id: "44444444-4444-4444-8444-444444444444", image_url: url("bannerStudio/results/x.jpg"), preview_url: url("bannerStudio/results/x_p.jpg") }], error: null };
    return { data: null, error: null };
  };
}

test("admin list: requires the admin token; single tool pages directly; all/banner merge both sources newest first", async () => {
  const s = await serve({ handler: adminHandler() });
  try {
    assert.equal((await s.get("/admin-dashboard/user-exports", null)).status, 401);
    assert.equal((await s.get("/admin-dashboard/user-exports", "wrong")).status, 401);
    const pdf = await s.get("/admin-dashboard/user-exports?tool=catalog_pdf&from=2026-09-01&to=2026-09-30");
    assert.equal(pdf.status, 200);
    assert.deepEqual(pdf.data.data.map((r) => r.id), ["e2"]);
    assert.equal(pdf.data.total, 1);
    const call = s.db.calls.find((c) => c.table === "user_exports");
    assert.deepEqual(op(call.ops, "gte"), ["gte", "created_at", "2026-08-31T21:00:00.000Z"]);
    assert.deepEqual(op(call.ops, "lt"), ["lt", "created_at", "2026-09-30T21:00:00.000Z"]);
    const all = await s.get("/admin-dashboard/user-exports?from=2026-09-01&to=2026-09-30");
    assert.deepEqual(all.data.data.map((r) => r.id), ["e1", "b1", "e2", "b2"]);
    assert.equal(all.data.total, 4);
    const e1 = all.data.data[0];
    assert.equal(e1.user_email, "a@example.com");
    assert.equal(e1.user_platform, "ios");
    const b2 = all.data.data[3];
    assert.equal(b2.tool, "banner");
    assert.equal(b2.file_url, url("bannerStudio/results/x.jpg"), "batch save without a file falls back to the AI result image");
    assert.equal(b2.meta.ai_content, true);
    assert.equal(b2.user_email, null);
    const banner = await s.get("/admin-dashboard/user-exports?tool=banner&from=2026-09-01&to=2026-09-30");
    assert.deepEqual(banner.data.data.map((r) => r.id), ["b1", "b2"]);
    const page2 = await s.get("/admin-dashboard/user-exports?from=2026-09-01&to=2026-09-30&limit=3&page=2");
    assert.deepEqual(page2.data.data.map((r) => r.id), ["b2"]);
    assert.equal(page2.data.totalPages, 2);
    const search = await s.get("/admin-dashboard/user-exports?from=2026-09-01&to=2026-09-30&search=a%40example");
    assert.deepEqual(search.data.data.map((r) => r.id), ["e1", "b1"]);
    const ilike = s.db.calls.filter((c) => c.table === "users").map((c) => op(c.ops, "ilike")).find(Boolean);
    assert.deepEqual(ilike, ["ilike", "email", "%a@example%"]);
  } finally { await s.close(); }
});

test("admin list: a missing table is reported in notReady instead of failing", async () => {
  const s = await serve({ handler: adminHandler({ missingExports: true }) });
  try {
    const r = await s.get("/admin-dashboard/user-exports?from=2026-09-01&to=2026-09-30");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.notReady, ["user_exports"]);
    assert.deepEqual(r.data.data.map((x) => x.id), ["b1", "b2"]);
  } finally { await s.close(); }
});

test("admin stats: per tool per Istanbul day, totals, unique users, notReady", async () => {
  const s = await serve({ handler: (table, ops) => {
    const range = op(ops, "range");
    if (range[1] > 0) return { data: [], error: null };
    if (table === "user_exports") return { data: [
      { tool: "collage", user_id: A, created_at: "2026-09-29T22:30:00.000Z" }, // 30 Eyl İstanbul
      { tool: "collage", user_id: A, created_at: "2026-09-30T10:00:00.000Z" },
      { tool: "film_lab", user_id: B, created_at: "2026-09-28T10:00:00.000Z" },
      { tool: "catalog_pdf", user_id: B, created_at: "2026-09-30T20:59:00.000Z" },
    ], error: null };
    if (table === "banner_gallery_downloads") return { data: null, error: { code: "42P01", message: 'relation "banner_gallery_downloads" does not exist' } };
    return { data: null, error: null };
  } });
  try {
    assert.equal((await s.get("/admin-dashboard/user-exports/stats", null)).status, 401);
    const r = await s.get("/admin-dashboard/user-exports/stats?from=2026-09-28&to=2026-09-30");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.days, [
      { date: "2026-09-28", catalog_pdf: 0, collage: 0, film_lab: 1, banner: 0, total: 1 },
      { date: "2026-09-29", catalog_pdf: 0, collage: 0, film_lab: 0, banner: 0, total: 0 },
      { date: "2026-09-30", catalog_pdf: 1, collage: 2, film_lab: 0, banner: 0, total: 3 },
    ]);
    assert.deepEqual(r.data.totals, { catalog_pdf: 1, collage: 2, film_lab: 1, banner: 0, total: 4 });
    assert.deepEqual(r.data.users, { catalog_pdf: 1, collage: 1, film_lab: 1, banner: 0 });
    assert.deepEqual(r.data.notReady, ["banner_gallery_downloads"]);
    assert.equal(r.data.truncated, false);
  } finally { await s.close(); }
});
