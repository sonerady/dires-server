-- Videos tablosu oluşturma scripti
-- Bu scripti Supabase SQL Editor'da çalıştırın

-- Videos tablosu
CREATE TABLE IF NOT EXISTS videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type VARCHAR(50) NOT NULL CHECK (type IN ('hero', 'paywall', 'before_after')),
    title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index'ler
CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(type);
CREATE INDEX IF NOT EXISTS idx_videos_active ON videos(is_active);
CREATE INDEX IF NOT EXISTS idx_videos_priority ON videos(priority);
CREATE INDEX IF NOT EXISTS idx_videos_type_active ON videos(type, is_active);

-- RLS (Row Level Security) aktif et
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- RLS Policy'leri - herkes okuyabilir, sadece admin yazabilir
CREATE POLICY "Anyone can view videos" ON videos
    FOR SELECT USING (true);

-- Varsayılan video verilerini ekle
INSERT INTO videos (type, title, url, description, priority) VALUES
-- Hero videoları (HomeScreen için)
('hero', 'Ana Hero Video', 'https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/hero_main.mp4', 'Ana sayfa hero videosu', 1),

-- Paywall videoları (PaywallV3Screen için)  
('paywall', 'Paywall Hero Video', 'https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/paywall_hero.mp4', 'Paywall sayfası hero videosu', 1),

-- Before/After videoları (Popular cards için)
('before_after', 'Image to Video Example', 'https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/before_after_video.mp4', 'Resimden videoya dönüşüm örneği', 1);

-- Trigger fonksiyonu - updated_at otomatik güncelleme
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger oluştur
CREATE TRIGGER update_videos_updated_at 
    BEFORE UPDATE ON videos 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Başarı mesajı
SELECT 'Videos tablosu başarıyla oluşturuldu!' as message;
