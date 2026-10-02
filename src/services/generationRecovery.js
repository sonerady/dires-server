// Refiner / Back Side use pay-on-success and store their canonical state here.
// A crashed HTTP process cannot run catch/finally: recover its abandoned rows
// independently of client polling, without touching credits or successful media.
const ACTIVE = ["pending", "processing"];
const STALE_MS = 30 * 60 * 1000;
const MAX_HEARTBEAT_MS = 90 * 60 * 1000;
const FAMILIES = "settings->>isRefinerMode.eq.true,settings->>isBackSideCloset.eq.true";
const MIRRORS = ["refiner_generations", "back_side_generations"];

function startGenerationHeartbeat(db, generationId, userId, { intervalMs = 60000, now = Date.now, logger = console } = {}) {
  const startedAt = now();
  let running = false;
  const timer = setInterval(async () => {
    // A hung provider must not keep the lease alive forever.
    if (now() - startedAt >= MAX_HEARTBEAT_MS) { clearInterval(timer); return; }
    if (running) return;
    running = true;
    try {
      const { error } = await db.from("reference_results")
        .update({ updated_at: new Date(now()).toISOString() })
        .eq("generation_id", generationId).eq("user_id", userId)
        .in("status", ACTIVE).is("result_image_url", null).abortSignal(AbortSignal.timeout(15000));
      if (error) throw error;
    } catch (error) { logger.error("[generation-recovery] heartbeat failed", error.message); }
    finally { running = false; }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function recoverStaleGenerations(db, { now = Date.now(), userId, generationIds, dryRun = false, limit = 100 } = {}) {
  const cutoff = new Date(now - STALE_MS).toISOString();
  const scope = q => {
    if (userId) q = q.eq("user_id", userId);
    if (generationIds) q = q.in("generation_id", generationIds);
    return q;
  };
  const summary = { candidates: [], recovered: [], mirrors: [], skippedPaid: [] };
  const { data: rows, error } = await scope(db.from("reference_results")
    .select("id,generation_id,user_id,status,settings,updated_at,created_at")
    .in("status", ACTIVE).is("result_image_url", null).or(FAMILIES)
    .lt("updated_at", cutoff).order("updated_at").limit(limit).abortSignal(AbortSignal.timeout(15000)));
  if (error) throw error;
  for (const row of rows || []) {
    if (row.settings?.creditDeducted === true) { summary.skippedPaid.push(row.generation_id); continue; }
    summary.candidates.push(row.generation_id);
    if (dryRun) continue;
    const { data, error: writeError } = await db.from("reference_results")
      .update({ status: "failed", updated_at: new Date(now).toISOString(), settings: {
        ...row.settings,
        generationRecovery: { reason: "worker_inactive_timeout", recoveredAt: new Date(now).toISOString(), lastActivityAt: row.updated_at },
      } })
      .eq("id", row.id).eq("user_id", row.user_id)
      // Compare-and-set: a heartbeat/completion after SELECT wins this race.
      .eq("updated_at", row.updated_at).in("status", ACTIVE)
      .is("result_image_url", null).select("generation_id").abortSignal(AbortSignal.timeout(15000));
    if (writeError) throw writeError;
    if (data?.length) summary.recovered.push(row.generation_id);
  }
  if (dryRun) return summary;

  // Retry mirror synchronization independently. A previous sweep may have
  // updated the canonical row before a temporary mirror-table write failure.
  // ⚠️ 25 Eyl 2026: one generation_id can own SEVERAL canonical rows (the same
  // job submitted twice seconds apart, ~1 every few days). `.maybeSingle()` threw
  // "JSON object requested, multiple (or no) rows returned" on it and aborted the
  // whole sweep every minute, so every later mirror stayed "processing" forever.
  // Now: read all canonical rows, pick per mirror, and one bad mirror no longer
  // blocks the rest (errors are collected and rethrown at the end for the log).
  const errors = [];
  for (const table of MIRRORS) {
    const { data: mirrors, error: readError } = await scope(db.from(table)
      .select("id,generation_id,user_id,updated_at,created_at")
      .in("status", ACTIVE).is("result_image_url", null)
      .lt("updated_at", cutoff).order("updated_at").limit(limit).abortSignal(AbortSignal.timeout(15000)));
    if (readError) throw readError;
    for (const mirror of mirrors || []) {
      try {
        const { data: canonicals, error: canonicalError } = await db.from("reference_results")
          .select("status,result_image_url,created_at").eq("generation_id", mirror.generation_id)
          .eq("user_id", mirror.user_id).limit(20).abortSignal(AbortSignal.timeout(15000));
        if (canonicalError) throw canonicalError;
        const canonical = pickCanonical(canonicals, mirror.created_at);
        if (!canonical) continue;
        const update = { status: canonical.status, updated_at: new Date(now).toISOString() };
        if (canonical.result_image_url) update.result_image_url = canonical.result_image_url;
        const { data, error: mirrorError } = await db.from(table).update(update)
          .eq("id", mirror.id).eq("user_id", mirror.user_id).eq("updated_at", mirror.updated_at)
          .in("status", ACTIVE).is("result_image_url", null).select("generation_id").abortSignal(AbortSignal.timeout(15000));
        if (mirrorError) throw mirrorError;
        if (data?.length) summary.mirrors.push({ table, generationId: mirror.generation_id, status: canonical.status });
      } catch (error) {
        errors.push(`${table}:${mirror.generation_id}: ${error?.message || error}`);
      }
    }
  }
  if (errors.length) throw Object.assign(new Error(`mirror sync failed (${errors.length}) — ${errors.slice(0, 3).join(" | ")}`), { summary });
  return summary;
}

// Canonical row(s) → the state a stale mirror should adopt, or null to leave it.
// Several rows (duplicate submit): a completed image wins, closest in time to the
// mirror row; "failed" only when every canonical row failed.
function pickCanonical(rows, mirrorCreatedAt) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  const done = list.filter(r => r.status === "completed" && r.result_image_url);
  if (done.length) {
    const at = Date.parse(mirrorCreatedAt || "") || 0;
    const gap = r => Math.abs((Date.parse(r.created_at || "") || 0) - at);
    return done.slice().sort((a, b) => gap(a) - gap(b))[0];
  }
  return list.every(r => r.status === "failed") ? { status: "failed", result_image_url: null } : null;
}

function startGenerationRecovery(db, { intervalMs = 60000, logger = console } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await recoverStaleGenerations(db);
      if (result.recovered.length || result.mirrors.length || result.skippedPaid.length) logger.log("[generation-recovery]", result);
    } catch (error) { logger.error("[generation-recovery] sweep failed", error.message); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { pickCanonical, recoverStaleGenerations, startGenerationRecovery, startGenerationHeartbeat, STALE_MS };
