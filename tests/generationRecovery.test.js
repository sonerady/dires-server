const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recoverStaleGenerations, startGenerationHeartbeat } = require("../src/services/generationRecovery");
const now = Date.parse("2026-09-07T12:00:00Z");
const old = new Date(now - 3600000).toISOString();
const row = (id, extra = {}) => ({ id, generation_id: id, user_id: "owner", status: "processing", updated_at: old, created_at: old, result_image_url: null, settings: { isRefinerMode: true }, ...extra });

// In-memory PostgREST boundary: run the actual service and evaluate its filters.
function database(tables, beforeWrite) {
  const db = { writes: [], from(table) {
    let filters = [], update, single = false, limit = Infinity;
    const q = {
      abortSignal() { return q; }, select() { return q; }, update(value) { update = value; return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, v) { filters.push(r => v.includes(r[k])); return q; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      lt(k, v) { filters.push(r => r[k] < v); return q; },
      or() { filters.push(r => r.settings?.isRefinerMode || r.settings?.isBackSideCloset); return q; },
      order() { return q; }, limit(n) { limit = n; return q; },
      maybeSingle() { single = true; return q; },
      async then(resolve, reject) {
        try {
          if (update) beforeWrite?.(table, tables, update);
          const rows = (tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, limit);
          if (update) { db.writes.push({ table, update }); rows.forEach(r => Object.assign(r, update)); }
          return resolve({ data: single ? structuredClone(rows[0] || null) : structuredClone(rows), error: null });
        } catch (e) { return reject(e); }
      },
    };
    return q;
  } };
  return db;
}

test("recovers abandoned jobs and mirrors, without changing credits or unrelated rows", async () => {
  const tables = { reference_results: [row("stale"), row("fresh", { updated_at: new Date(now).toISOString() }), row("done", { status: "completed", result_image_url: "image" }), row("other", { settings: {} }), row("paid", { settings: { isRefinerMode: true, creditDeducted: true } })], refiner_generations: [row("stale", { credits_used: 10 })] };
  const db = database(tables);
  const result = await recoverStaleGenerations(db, { now });
  assert.deepEqual(result.recovered, ["stale"]);
  assert.deepEqual(result.skippedPaid, ["paid"]);
  assert.equal(tables.refiner_generations[0].status, "failed");
  assert.equal(tables.refiner_generations[0].credits_used, 10);
  assert.equal(tables.reference_results[1].status, "processing");
  assert.equal(tables.reference_results[2].result_image_url, "image");
  assert.equal(tables.reference_results[3].status, "processing");
  assert.ok(db.writes.every(w => !Object.keys(w.update).some(k => /credit/.test(k))));
  assert.deepEqual((await recoverStaleGenerations(db, { now })).recovered, []);
});

test("dry run and explicit repair scope never modify another account or job", async () => {
  const tables = { reference_results: [row("a"), row("b"), row("a", { id: "other-owner", user_id: "another" })] };
  const db = database(tables);
  const scope = { now, userId: "owner", generationIds: ["a"] };
  assert.deepEqual((await recoverStaleGenerations(db, { ...scope, dryRun: true })).candidates, ["a"]);
  assert.equal(db.writes.length, 0);
  assert.deepEqual((await recoverStaleGenerations(db, scope)).recovered, ["a"]);
  assert.equal(tables.reference_results[1].status, "processing");
  assert.equal(tables.reference_results[2].status, "processing");
});

test("concurrent completion or heartbeat wins over recovery", async () => {
  for (const change of [{ status: "completed", result_image_url: "late-success" }, { updated_at: new Date(now).toISOString() }]) {
    const tables = { reference_results: [row("race")] };
    const db = database(tables, (_, t) => Object.assign(t.reference_results[0], change));
    assert.deepEqual((await recoverStaleGenerations(db, { now })).recovered, []);
    assert.notEqual(tables.reference_results[0].status, "failed");
  }
});

test("a mirror write failure is repaired on the next sweep", async () => {
  const tables = { reference_results: [row("retry")], refiner_generations: [row("retry")] };
  let fail = true;
  const db = database(tables, table => { if (table === "refiner_generations" && fail) { fail = false; throw new Error("temporary failure"); } });
  await assert.rejects(recoverStaleGenerations(db, { now }), /temporary failure/);
  assert.equal(tables.reference_results[0].status, "failed");
  assert.equal(tables.refiner_generations[0].status, "processing");
  const retry = await recoverStaleGenerations(db, { now });
  assert.equal(retry.mirrors.length, 1);
  assert.equal(tables.refiner_generations[0].status, "failed");
});

test("mirror repair preserves completed images and adopts canonical success", async () => {
  const tables = { reference_results: [row("success", { status: "completed", result_image_url: "saved" }), row("failed", { status: "failed" })], back_side_generations: [row("success"), row("failed", { status: "completed", result_image_url: "preserve" })] };
  await recoverStaleGenerations(database(tables), { now });
  assert.equal(tables.back_side_generations[0].result_image_url, "saved");
  assert.equal(tables.back_side_generations[1].result_image_url, "preserve");
  assert.equal(tables.back_side_generations[1].status, "completed");
});

test("heartbeat touches only its active owner/job and stops on cleanup", async () => {
  const tables = { reference_results: [row("active"), row("done", { status: "completed" })] };
  const db = database(tables);
  const stop = startGenerationHeartbeat(db, "active", "owner", { intervalMs: 5, now: () => now });
  await new Promise(resolve => setTimeout(resolve, 25));
  stop();
  const writes = db.writes.length;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(writes > 0);
  assert.equal(db.writes.length, writes);
  assert.equal(tables.reference_results[0].updated_at, new Date(now).toISOString());
  assert.equal(tables.reference_results[1].updated_at, old);
});
