-- Add original_image_url column to user_models table
-- This column stores the original uploaded image URL before transformation
-- This column is nullable to support older app versions that don't have this feature

ALTER TABLE user_models
ADD COLUMN IF NOT EXISTS original_image_url TEXT DEFAULT NULL;

-- Add comment to column
COMMENT ON COLUMN user_models.original_image_url IS 'URL of the original image uploaded by the user before transformation. NULL for models created from text prompts or older app versions.';

