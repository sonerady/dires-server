-- Add team subscription columns to users table
-- Run this migration in Supabase SQL Editor

-- Add team_max_members column (stores the number of team members allowed from team subscription)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS team_max_members INTEGER DEFAULT 0;

-- Add team_subscription_active column (tracks if user has active team subscription)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS team_subscription_active BOOLEAN DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN users.team_max_members IS 'Maximum team members allowed from team subscription package (1-6)';
COMMENT ON COLUMN users.team_subscription_active IS 'Whether user has an active team subscription';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_team_subscription
ON users (team_subscription_active)
WHERE team_subscription_active = true;
