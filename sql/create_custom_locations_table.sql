-- Custom Locations tablosu oluştur
CREATE TABLE IF NOT EXISTS custom_locations (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_prompt TEXT NOT NULL,
    enhanced_prompt TEXT,
    image_url TEXT,
    replicate_id VARCHAR(255),
    category VARCHAR(50) DEFAULT 'custom',
    user_id VARCHAR(255),
    is_public BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes ekle
CREATE INDEX IF NOT EXISTS idx_custom_locations_user_id ON custom_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_locations_category ON custom_locations(category);
CREATE INDEX IF NOT EXISTS idx_custom_locations_is_public ON custom_locations(is_public);
CREATE INDEX IF NOT EXISTS idx_custom_locations_status ON custom_locations(status);
CREATE INDEX IF NOT EXISTS idx_custom_locations_created_at ON custom_locations(created_at DESC);

-- RLS (Row Level Security) politikaları
ALTER TABLE custom_locations ENABLE ROW LEVEL SECURITY;

-- Public locations herkes görebilir
CREATE POLICY "Public locations are viewable by everyone" 
ON custom_locations FOR SELECT 
USING (is_public = true AND status = 'completed');

-- Kullanıcılar kendi location'larını görebilir
CREATE POLICY "Users can view their own locations" 
ON custom_locations FOR SELECT 
USING (auth.uid()::text = user_id);

-- Kullanıcılar kendi location'larını oluşturabilir
CREATE POLICY "Users can create their own locations" 
ON custom_locations FOR INSERT 
WITH CHECK (auth.uid()::text = user_id);

-- Kullanıcılar kendi location'larını güncelleyebilir
CREATE POLICY "Users can update their own locations" 
ON custom_locations FOR UPDATE 
USING (auth.uid()::text = user_id);

-- Kullanıcılar kendi location'larını silebilir
CREATE POLICY "Users can delete their own locations" 
ON custom_locations FOR DELETE 
USING (auth.uid()::text = user_id);

-- Updated_at trigger'ı ekle
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_custom_locations_updated_at 
    BEFORE UPDATE ON custom_locations 
    FOR EACH ROW 
    EXECUTE PROCEDURE update_updated_at_column();

-- Örnek kategori constraints
ALTER TABLE custom_locations 
ADD CONSTRAINT check_category 
CHECK (category IN ('custom', 'outdoor', 'indoor', 'studio', 'colors'));

-- Örnek status constraints
ALTER TABLE custom_locations 
ADD CONSTRAINT check_status 
CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- Tablo yorumları
COMMENT ON TABLE custom_locations IS 'Kullanıcı tarafından oluşturulan özel location görselleri';
COMMENT ON COLUMN custom_locations.title IS 'Location başlığı';
COMMENT ON COLUMN custom_locations.original_prompt IS 'Kullanıcının girdiği orijinal prompt';
COMMENT ON COLUMN custom_locations.enhanced_prompt IS 'Gemini tarafından enhance edilmiş prompt';
COMMENT ON COLUMN custom_locations.image_url IS 'Flux.1 Dev tarafından generate edilen görsel URL';
COMMENT ON COLUMN custom_locations.replicate_id IS 'Replicate prediction ID';
COMMENT ON COLUMN custom_locations.category IS 'Location kategorisi (custom, outdoor, indoor, studio, colors)';
COMMENT ON COLUMN custom_locations.user_id IS 'Location oluşturan kullanıcının ID si';
COMMENT ON COLUMN custom_locations.is_public IS 'Diğer kullanıcılar görebilir mi?';
COMMENT ON COLUMN custom_locations.status IS 'Generation durumu (pending, processing, completed, failed)';
