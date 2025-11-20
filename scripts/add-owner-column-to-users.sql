-- Add owner column to users table
-- This column indicates if a user is an owner/admin
-- Default value is false (not an owner)

ALTER TABLE users
ADD COLUMN IF NOT EXISTS owner BOOLEAN DEFAULT false NOT NULL;

-- Add comment to the column
COMMENT ON COLUMN users.owner IS 'Indicates if the user is an owner/admin. Default is false.';

