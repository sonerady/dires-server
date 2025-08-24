-- Favorites tablosu oluşturma
CREATE TABLE IF NOT EXISTS user_favorite_locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    location_id VARCHAR(255) NOT NULL,
    location_type VARCHAR(50) NOT NULL, -- 'discovery', 'studio', 'outdoor', 'indoor', 'custom'
    location_title VARCHAR(255),
    location_image_url TEXT,
    location_category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: bir user aynı location'ı sadece bir kez favorite yapabilir
    CONSTRAINT unique_user_location UNIQUE (user_id, location_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_favorite_locations_user_id ON user_favorite_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_locations_location_id ON user_favorite_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_locations_type ON user_favorite_locations(location_type);
CREATE INDEX IF NOT EXISTS idx_user_favorite_locations_created_at ON user_favorite_locations(created_at DESC);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Updated at trigger
CREATE TRIGGER update_user_favorite_locations_updated_at 
    BEFORE UPDATE ON user_favorite_locations 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) policies
ALTER TABLE user_favorite_locations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see and modify their own favorites
CREATE POLICY "Users can view own favorites" ON user_favorite_locations
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own favorites" ON user_favorite_locations
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own favorites" ON user_favorite_locations
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own favorites" ON user_favorite_locations
    FOR DELETE USING (user_id = auth.uid());

-- Grant permissions
GRANT ALL ON user_favorite_locations TO authenticated;
GRANT ALL ON user_favorite_locations TO anon;

-- Comments
COMMENT ON TABLE user_favorite_locations IS 'User favorite locations storage';
COMMENT ON COLUMN user_favorite_locations.user_id IS 'Reference to the user who favorited this location';
COMMENT ON COLUMN user_favorite_locations.location_id IS 'ID of the favorited location';
COMMENT ON COLUMN user_favorite_locations.location_type IS 'Type/category of the location (discovery, studio, etc.)';
COMMENT ON COLUMN user_favorite_locations.location_title IS 'Cached title of the location for quick access';
COMMENT ON COLUMN user_favorite_locations.location_image_url IS 'Cached image URL of the location';
COMMENT ON COLUMN user_favorite_locations.location_category IS 'Additional category information';
