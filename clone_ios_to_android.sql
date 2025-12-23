-- SQL to clone the iOS configuration row for Android
-- This assumes standard columns. If you have language-specific columns (message_en, etc.), add them to the list.

INSERT INTO app_config (
    platform,
    min_version,
    latest_version,
    force_update,
    changelog_url,
    message,
    metadata,
    website_open
)
SELECT
    'android',
    min_version,
    latest_version,
    force_update,
    changelog_url,
    message,
    metadata,
    website_open
FROM app_config
WHERE platform = 'ios';
