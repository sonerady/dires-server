/**
 * Trial users may only create a limited number of videos.
 *
 * Enforced server-side so production users hit the cap immediately, with
 * no client-side change required. Apply on every video-generation entry
 * point BEFORE charging credits / dispatching to the upstream provider.
 *
 * Counts only videos created since the user entered their current trial
 * window — pre-trial generations (e.g. a returning user who later started
 * a trial) don't poison the cap.
 *
 * Fails OPEN on transient DB errors. We'd rather let one extra video
 * through than block a legitimate paid user because of a flaky lookup.
 */

const TRIAL_VIDEO_LIMIT = 2;

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
    .select("is_in_trial, trial_started_at")
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

  let countQuery = supabase
    .from("video_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (user.trial_started_at) {
    countQuery = countQuery.gte("created_at", user.trial_started_at);
  }

  const { count, error: countErr } = await countQuery;

  if (countErr) {
    console.warn(
      `[trialVideoLimit] count failed for ${userId}; failing open:`,
      countErr.message,
    );
    return null;
  }

  const used = count ?? 0;
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

module.exports = { enforceTrialVideoLimit, TRIAL_VIDEO_LIMIT };
