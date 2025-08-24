-- Add favorite_count column to custom_locations table
ALTER TABLE custom_locations 
ADD COLUMN favorite_count INTEGER DEFAULT 0;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_custom_locations_favorite_count ON custom_locations(favorite_count);

-- Update all existing locations with random favorite counts (1-1500)
UPDATE custom_locations 
SET favorite_count = FLOOR(RANDOM() * 1500) + 1
WHERE favorite_count = 0;

-- Create trigger to automatically update favorite_count when favorites are added/removed
CREATE OR REPLACE FUNCTION update_location_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Favorite eklendi, count'u artır
        UPDATE custom_locations 
        SET favorite_count = favorite_count + 1 
        WHERE id::text = NEW.location_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Favorite silindi, count'u azalt
        UPDATE custom_locations 
        SET favorite_count = GREATEST(favorite_count - 1, 0)
        WHERE id::text = OLD.location_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on user_favorite_locations table
DROP TRIGGER IF EXISTS trigger_update_favorite_count ON user_favorite_locations;
CREATE TRIGGER trigger_update_favorite_count
    AFTER INSERT OR DELETE ON user_favorite_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_location_favorite_count();

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'custom_locations' 
    AND column_name = 'favorite_count';

-- Show sample data
SELECT 
    id,
    title,
    generated_title,
    favorite_count
FROM custom_locations 
WHERE is_public = true
ORDER BY favorite_count DESC
LIMIT 10;
