/**
 * Trial users may only create a limited number of videos.
 *
 * Counted via `users.trial_video_count` (single column lookup) instead of
 * an aggregate on `video_generations`. The counter is incremented from
 * each video route immediately after the trial check passes, so this
 * source-of-truth is cheap to read on subsequent attempts and survives
 * even if a downstream insert/dispatch later fails (we'd rather slightly
 * over-count and block one extra request than under-count and let trial
 * users sneak past the cap).
 *
 * Fails OPEN on transient DB errors — better to let one extra video
 * through than block a legitimate paid user because of a flaky lookup.
 */

const TRIAL_VIDEO_LIMIT = 1;

/**
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {string} params.userId
 * @returns {Promise<null | { status: number, payload: object }>}
 *   `null` → allow the request through.
 *   `{ status, payload }` → caller should `res.status(status).json(payload)`
 *   and abort. Format mirrors the rest of this codebase's error envelopes.
 */
async function enforceTrialVideoLimit({ supabase, userId }) {
  if (!userId) return null;

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("is_in_trial, trial_video_count")
    .eq("id", userId)
    .single();

  if (userErr) {
    console.warn(
      `[trialVideoLimit] user lookup failed for ${userId}; failing open:`,
      userErr.message,
    );
    return null;
  }

  if (!user?.is_in_trial) return null;

  const used = Number.isFinite(user.trial_video_count)
    ? user.trial_video_count
    : 0;

  if (used < TRIAL_VIDEO_LIMIT) return null;

  console.log(
    `🚫 [trialVideoLimit] Trial user ${userId} blocked: ${used}/${TRIAL_VIDEO_LIMIT} videos already created`,
  );

  return {
    status: 403,
    payload: {
      success: false,
      code: "TRIAL_VIDEO_LIMIT",
      message: `Trial accounts are limited to ${TRIAL_VIDEO_LIMIT} videos. Upgrade your plan to create more.`,
      limit: TRIAL_VIDEO_LIMIT,
      used,
    },
  };
}

/**
 * Increment `users.trial_video_count` by 1 for trial users.
 * No-op for non-trial users. Safe to call after the trial check passed —
 * we read the current value and write back current+1.
 *
 * NOT strictly atomic (no SQL UPDATE … SET trial_video_count = trial_video_count + 1
 * via RPC), but a trial user can't race themselves meaningfully here —
 * each video request goes through enforceTrialVideoLimit first, which would
 * have rejected if they were already at the cap.
 */
async function incrementTrialVideoCount({ supabase, userId }) {
  if (!userId) return;

  try {
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("is_in_trial, trial_video_count")
      .eq("id", userId)
      .single();

    if (readErr) {
      console.warn(
        `[trialVideoLimit] increment read failed for ${userId}:`,
        readErr.message,
      );
      return;
    }

    if (!user?.is_in_trial) return;

    const current = Number.isFinite(user.trial_video_count)
      ? user.trial_video_count
      : 0;

    const { error: updateErr } = await supabase
      .from("users")
      .update({ trial_video_count: current + 1 })
      .eq("id", userId);

    if (updateErr) {
      console.warn(
        `[trialVideoLimit] increment write failed for ${userId}:`,
        updateErr.message,
      );
      return;
    }

    console.log(
      `🎬 [trialVideoLimit] ${userId} trial_video_count: ${current} → ${current + 1}`,
    );
  } catch (err) {
    console.warn(
      `[trialVideoLimit] increment unexpected error for ${userId}:`,
      err?.message || err,
    );
  }
}

module.exports = {
  enforceTrialVideoLimit,
  incrementTrialVideoCount,
  TRIAL_VIDEO_LIMIT,
};
