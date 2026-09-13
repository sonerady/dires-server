// Current account metadata for admin generation cards, not a historical snapshot.
const ADMIN_OWNER_FIELDS = 'id,email,is_pro,is_in_trial,has_used_trial,trial_started_at,credit_balance,theme_mode,platform,app_version';

function adminGenerationOwner(user) {
  return {
    user_email: user?.email || null,
    user_is_pro: user?.is_pro ?? null,
    user_is_in_trial: user?.is_in_trial ?? null,
    user_has_used_trial: user?.has_used_trial ?? null,
    user_trial_started_at: user?.trial_started_at || null,
    user_credit_balance: user?.credit_balance ?? null,
    user_theme_mode: user?.theme_mode || null,
    user_platform: user?.platform || null,
    user_app_version: user?.app_version || null,
  };
}

module.exports = { ADMIN_OWNER_FIELDS, adminGenerationOwner };
