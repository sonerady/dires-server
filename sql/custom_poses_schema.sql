-- Custom Poses tablosu oluşturma
CREATE TABLE IF NOT EXISTS custom_poses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    enhanced_description TEXT, -- Gemini ile enhance edilmiş açıklama
    gender VARCHAR(10) DEFAULT 'female' CHECK (gender IN ('male', 'female')),
    category VARCHAR(20) DEFAULT 'custom',
    image_url TEXT,
    supabase_image_path TEXT, -- Supabase storage path
    flux_prediction_id TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mevcut tabloya yeni sütunlar ekle (eğer tablo zaten varsa)
ALTER TABLE custom_poses ADD COLUMN IF NOT EXISTS enhanced_description TEXT;
ALTER TABLE custom_poses ADD COLUMN IF NOT EXISTS supabase_image_path TEXT;

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_custom_poses_user_id ON custom_poses(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_poses_gender ON custom_poses(gender);
CREATE INDEX IF NOT EXISTS idx_custom_poses_category ON custom_poses(category);
CREATE INDEX IF NOT EXISTS idx_custom_poses_is_active ON custom_poses(is_active);
CREATE INDEX IF NOT EXISTS idx_custom_poses_created_at ON custom_poses(created_at DESC);

-- RLS (Row Level Security) politikaları
ALTER TABLE custom_poses ENABLE ROW LEVEL SECURITY;

-- Kullanıcılar sadece kendi pozlarını görebilir
CREATE POLICY "Users can view own poses" ON custom_poses
    FOR SELECT USING (user_id = current_setting('app.current_user_id', true));

-- Kullanıcılar sadece kendi pozlarını ekleyebilir
CREATE POLICY "Users can insert own poses" ON custom_poses
    FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true));

-- Kullanıcılar sadece kendi pozlarını güncelleyebilir
CREATE POLICY "Users can update own poses" ON custom_poses
    FOR UPDATE USING (user_id = current_setting('app.current_user_id', true));

-- Kullanıcılar sadece kendi pozlarını silebilir (soft delete)
CREATE POLICY "Users can delete own poses" ON custom_poses
    FOR DELETE USING (user_id = current_setting('app.current_user_id', true));

-- Trigger fonksiyonu - updated_at otomatik güncelleme
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger oluşturma
CREATE TRIGGER update_custom_poses_updated_at 
    BEFORE UPDATE ON custom_poses 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Örnek veri (test için)
INSERT INTO custom_poses (user_id, title, description, gender, category) VALUES
('test_user_1', 'Confident Standing', 'Standing confidently with hands on hips, shoulders back, looking directly at camera', 'female', 'professional'),
('test_user_1', 'Casual Lean', 'Leaning against a wall casually with one foot crossed over the other', 'male', 'casual'),
('test_user_2', 'Dynamic Jump', 'Mid-air jump with arms extended upward, full of energy and movement', 'female', 'dynamic');

-- Yorum
COMMENT ON TABLE custom_poses IS 'Kullanıcıların özel poz tanımları ve Flux dev ile oluşturulan görselleri';
COMMENT ON COLUMN custom_poses.user_id IS 'Pozu oluşturan kullanıcının ID''si';
COMMENT ON COLUMN custom_poses.title IS 'Poz başlığı (max 100 karakter)';
COMMENT ON COLUMN custom_poses.description IS 'Poz açıklaması (Flux dev için kullanılır)';
COMMENT ON COLUMN custom_poses.gender IS 'Poz için cinsiyet (male/female)';
COMMENT ON COLUMN custom_poses.category IS 'Poz kategorisi (custom, professional, casual, dynamic, vb.)';
COMMENT ON COLUMN custom_poses.image_url IS 'Flux dev ile oluşturulan görsel URL''si';
COMMENT ON COLUMN custom_poses.flux_prediction_id IS 'Flux dev prediction ID''si (durum takibi için)';
COMMENT ON COLUMN custom_poses.is_active IS 'Poz aktif mi (soft delete için)';
COMMENT ON COLUMN custom_poses.enhanced_description IS 'Gemini ile enhance edilmiş açıklama';
COMMENT ON COLUMN custom_poses.supabase_image_path IS 'Supabase storage path'; 