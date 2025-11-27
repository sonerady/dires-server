-- Migration: Add push_token columns to users table
-- Run this SQL in your Supabase SQL Editor

-- Add push_token column (nullable, text)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Add push_token_updated_at column (nullable, timestamp)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMP WITH TIME ZONE;

-- Add index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_push_token ON users(push_token) WHERE push_token IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.push_token IS 'Expo push notification token for the user';
COMMENT ON COLUMN users.push_token_updated_at IS 'Timestamp when the push token was last updated';







