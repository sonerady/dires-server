-- STEP 2: User ID column ekle
ALTER TABLE custom_locations 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- User ID için index ekle
CREATE INDEX IF NOT EXISTS idx_custom_locations_user_id 
ON custom_locations(user_id);
