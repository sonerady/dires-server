-- Add terms_accepted column to user_models table
-- This column is nullable to support older app versions that don't have this feature

ALTER TABLE user_models
ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT NULL;

-- Add comment to column
COMMENT ON COLUMN user_models.terms_accepted IS 'Indicates whether the user accepted terms and conditions when uploading a photo. NULL for older app versions, true/false for newer versions.';

