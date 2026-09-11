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
  for (const table of MIRRORS) {
    const { data: mirrors, error: readError } = await scope(db.from(table)
      .select("id,generation_id,user_id,updated_at")
      .in("status", ACTIVE).is("result_image_url", null)
      .lt("updated_at", cutoff).order("updated_at").limit(limit).abortSignal(AbortSignal.timeout(15000)));
    if (readError) throw readError;
    for (const mirror of mirrors || []) {
      const { data: canonical, error: canonicalError } = await db.from("reference_results")
        .select("status,result_image_url").eq("generation_id", mirror.generation_id)
        .eq("user_id", mirror.user_id).maybeSingle().abortSignal(AbortSignal.timeout(15000));
      if (canonicalError) throw canonicalError;
      if (!canonical || !["failed", "completed"].includes(canonical.status)) continue;
      if (canonical.status === "completed" && !canonical.result_image_url) continue;
      const update = { status: canonical.status, updated_at: new Date(now).toISOString() };
      if (canonical.result_image_url) update.result_image_url = canonical.result_image_url;
      const { data, error: mirrorError } = await db.from(table).update(update)
        .eq("id", mirror.id).eq("user_id", mirror.user_id).eq("updated_at", mirror.updated_at)
        .in("status", ACTIVE).is("result_image_url", null).select("generation_id").abortSignal(AbortSignal.timeout(15000));
      if (mirrorError) throw mirrorError;
      if (data?.length) summary.mirrors.push({ table, generationId: mirror.generation_id, status: canonical.status });
    }
  }
  return summary;
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

module.exports = { recoverStaleGenerations, startGenerationRecovery, startGenerationHeartbeat, STALE_MS };
