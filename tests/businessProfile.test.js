// 🏪 İşletme profili — doğrulama, birleştirme, kimlik, göç öncesi (not_ready) ve hız sınırı (30 Eyl 2026)
// Çalıştır: node --test tests/businessProfile.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBusinessProfileRouter, core } = require("../src/routes/businessProfileRoutes");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/** Supabase'in users tablosunun küçük taklidi: select(...).eq(...).maybeSingle() ve update(...).eq(...) */
function fakeDb({ rows = { [A]: { business_profile: {} }, [B]: { business_profile: { storeName: "B Store" } } }, missingColumn = false, failRead = false } = {}) {
  const writes = [];
  return {
    rows, writes,
    from(table) {
      assert.equal(table, "users");
      let mode = "select", patch = null, id = null;
      const q = {
        select(cols) { assert.equal(cols, "business_profile"); return q; },
        update(value) { mode = "update"; patch = value; return q; },
        eq(col, value) { assert.equal(col, "id"); id = value; return mode === "update" ? q.run() : q; },
        maybeSingle() { return q.run(); },
        run() {
          if (missingColumn) {
            return Promise.resolve({ data: null, error: mode === "update"
              ? { code: "PGRST204", message: "Could not find the 'business_profile' column of 'users' in the schema cache" }
              : { code: "42703", message: "column users.business_profile does not exist" } });
          }
          if (failRead) return Promise.resolve({ data: null, error: { code: "08006", message: "connection failure" } });
          if (mode === "update") {
            writes.push({ id, patch });
            if (rows[id]) rows[id] = { ...rows[id], ...patch };
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: rows[id] ? { business_profile: rows[id].business_profile } : null, error: null });
        },
      };
      return q;
    },
  };
}

// Kimlik taklidi: gerçek refundIdentity ile aynı sözleşme (userId → req.refundUserId, cihaz başlığı şart)
const identity = (req, res, next) => {
  const id = req.body?.userId || req.query.userId;
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return res.status(400).json({ success: false, reason: "invalid_user" });
  if (req.headers["x-device-id"] !== `device-${id}`) return res.status(401).json({ success: false, reason: "identity_required" });
  req.refundUserId = id;
  next();
};

async function serve(options = {}) {
  const db = options.db || fakeDb(options);
  const app = express();
  app.use(express.json());
  app.use("/api/business-profile", createBusinessProfileRouter({ db, identity: options.identity || identity, limits: options.limits }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/business-profile`;
  const call = async (method, { user = A, body, device } = {}) => {
    const r = await fetch(`${base}?userId=${user}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Device-Id": device === undefined ? `device-${user}` : device },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), cache: r.headers.get("cache-control") };
  };
  return { db, call, close: () => new Promise((r) => server.close(r)) };
}

test("validatePatch: only known string fields, trimmed, ≤200 chars; empty string / null = delete", () => {
  assert.deepEqual(core.FIELDS, ["storeName", "website", "phone", "email", "social", "address", "whatsapp"]);
  assert.equal(core.validatePatch(null).reason, "invalid_body");
  assert.equal(core.validatePatch({}).reason, "invalid_profile");
  assert.equal(core.validatePatch({ profile: [] }).reason, "invalid_profile");
  assert.equal(core.validatePatch({ profile: {} }).reason, "empty_profile");
  assert.deepEqual(core.validatePatch({ profile: { logo: "x" } }), { ok: false, reason: "unknown_field", field: "logo" });
  assert.deepEqual(core.validatePatch({ profile: { phone: 5551234 } }), { ok: false, reason: "invalid_value", field: "phone" });
  assert.deepEqual(core.validatePatch({ profile: { website: { href: "x" } } }), { ok: false, reason: "invalid_value", field: "website" });
  assert.deepEqual(core.validatePatch({ profile: { address: "x".repeat(201) } }), { ok: false, reason: "too_long", field: "address" });
  assert.equal(core.validatePatch({ profile: { address: `  ${"x".repeat(200)}  ` } }).ok, true, "length is measured after trimming");
  const ok = core.validatePatch({ profile: { storeName: "  Moda\u0007  Evi \n", website: "", email: null, social: "@moda‮evi" } });
  assert.deepEqual(ok, { ok: true, patch: { storeName: "Moda Evi", website: "", email: "", social: "@moda evi" } });
  // Yazarken yarım değerler reddedilmez (istemci 800 ms'de bir kaydeder)
  assert.equal(core.validatePatch({ profile: { email: "ali@", website: "www." } }).ok, true);
});

test("mergeProfile / normalizeStored: merge, delete on empty, drop junk from the stored json", () => {
  assert.deepEqual(core.mergeProfile({ storeName: "A", phone: "1" }, { phone: "", website: "a.com" }), { storeName: "A", website: "a.com" });
  assert.deepEqual(core.normalizeStored({ storeName: " A ", evil: "x", phone: 12, website: "" }), { storeName: "A" });
  assert.deepEqual(core.normalizeStored("nope"), {});
  assert.deepEqual(core.normalizeStored(null), {});
  assert.equal(core.isMissingColumn({ code: "42703" }), true);
  assert.equal(core.isMissingColumn({ code: "PGRST204" }), true);
  assert.equal(core.isMissingColumn({ code: "08006", message: "connection failure" }), false);
  assert.equal(core.isMissingColumn(null), false);
});

test("GET returns the saved profile; PUT merges partial updates and deletes cleared keys", async () => {
  const h = await serve();
  try {
    let r = await h.call("GET");
    assert.deepEqual(r, { status: 200, data: { success: true, profile: {} }, cache: "private, no-store" });
    r = await h.call("PUT", { body: { profile: { storeName: " Moda Evi ", website: "modaevi.com", phone: "+90 555 000 00 00" } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { success: true, profile: { storeName: "Moda Evi", website: "modaevi.com", phone: "+90 555 000 00 00" } });
    r = await h.call("PUT", { body: { profile: { phone: "", social: "@modaevi" } } });
    assert.deepEqual(r.data.profile, { storeName: "Moda Evi", website: "modaevi.com", social: "@modaevi" });
    r = await h.call("GET");
    assert.deepEqual(r.data.profile, { storeName: "Moda Evi", website: "modaevi.com", social: "@modaevi" });
    // Hesaplar birbirine karışmaz
    assert.deepEqual((await h.call("GET", { user: B })).data.profile, { storeName: "B Store" });
    assert.ok(h.db.writes.every((w) => w.id === A));
  } finally {
    await h.close();
  }
});

test("strict validation: bad bodies are 400 and never touch the database", async () => {
  const h = await serve();
  try {
    for (const body of [{}, { profile: "x" }, { profile: {} }, { profile: { logoUrl: "x" } }, { profile: { phone: 1 } }, { profile: { storeName: "x".repeat(300) } }]) {
      const r = await h.call("PUT", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.data.success, false);
    }
    assert.equal(h.db.writes.length, 0);
  } finally {
    await h.close();
  }
});

test("identity: a bare UUID is not enough; unknown accounts are 404", async () => {
  const h = await serve();
  try {
    assert.equal((await h.call("GET", { user: "not-a-uuid" })).status, 400);
    assert.equal((await h.call("GET", { device: "someone-else" })).status, 401);
    assert.equal((await h.call("PUT", { device: "", body: { profile: { storeName: "x" } } })).status, 401);
    const ghost = "33333333-3333-4333-8333-333333333333";
    assert.equal((await h.call("GET", { user: ghost })).status, 404);
    assert.equal((await h.call("PUT", { user: ghost, body: { profile: { storeName: "x" } } })).status, 404);
    assert.equal(h.db.writes.length, 0);
  } finally {
    await h.close();
  }
});

test("migration not applied yet: GET and PUT answer not_ready (200), never 500", async () => {
  const h = await serve({ missingColumn: true });
  try {
    assert.deepEqual((await h.call("GET")).data, { success: false, reason: "not_ready" });
    const r = await h.call("PUT", { body: { profile: { storeName: "x" } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { success: false, reason: "not_ready" });
  } finally {
    await h.close();
  }
  // Yazma sırasında şema önbelleği hatası (okuma başarılı, update PGRST204) da temiz döner
  const db = fakeDb();
  const from = db.from.bind(db);
  db.from = (t) => { const q = from(t); const update = q.update; q.update = (v) => { update(v); q.run = () => Promise.resolve({ data: null, error: { code: "PGRST204", message: "Could not find the 'business_profile' column" } }); return q; }; return q; };
  const h2 = await serve({ db });
  try {
    const r = await h2.call("PUT", { body: { profile: { storeName: "x" } } });
    assert.deepEqual({ status: r.status, data: r.data }, { status: 200, data: { success: false, reason: "not_ready" } });
  } finally {
    await h2.close();
  }
});

test("other database failures are a clean 500 without leaking details", async () => {
  const h = await serve({ failRead: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await h.call("GET");
    assert.deepEqual({ status: r.status, data: r.data }, { status: 500, data: { success: false, reason: "request_failed" } });
  } finally {
    console.warn = warn;
    await h.close();
  }
});

test("rate limit: per-account, answers 429 rate_limited", async () => {
  const h = await serve({ limits: { getPerMinute: 2, putPerMinute: 1 } });
  try {
    assert.equal((await h.call("GET")).status, 200);
    assert.equal((await h.call("GET")).status, 200);
    const r = await h.call("GET");
    assert.deepEqual({ status: r.status, data: r.data }, { status: 429, data: { success: false, reason: "rate_limited" } });
    assert.equal((await h.call("GET", { user: B })).status, 200, "another account has its own budget");
    assert.equal((await h.call("PUT", { body: { profile: { storeName: "x" } } })).status, 200);
    assert.equal((await h.call("PUT", { body: { profile: { storeName: "y" } } })).status, 429);
  } finally {
    await h.close();
  }
});

test("no database client → 503 unavailable", async () => {
  const app = express();
  app.use("/bp", createBusinessProfileRouter({ db: null, identity }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/bp?userId=${A}`);
    assert.equal(r.status, 503);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
