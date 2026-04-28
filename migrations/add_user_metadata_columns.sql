-- Migration: Add user metadata columns (app_version, platform, theme_mode) to users table
-- Run this SQL in your Supabase SQL Editor
-- All columns are NULLABLE so existing user rows are NOT affected.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS app_version TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS platform TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS theme_mode TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform) WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_app_version ON users(app_version) WHERE app_version IS NOT NULL;

COMMENT ON COLUMN users.app_version IS 'Last reported app version from the client (e.g. 1.6.1)';
COMMENT ON COLUMN users.platform IS 'Last reported platform from the client (ios | android)';
COMMENT ON COLUMN users.theme_mode IS 'Last reported theme preference from the client (light | dark)';
COMMENT ON COLUMN users.metadata_updated_at IS 'Timestamp when app_version/platform/theme_mode were last refreshed';
