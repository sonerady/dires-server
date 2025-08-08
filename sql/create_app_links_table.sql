-- App Store ve Google Play Store linklerini yönetmek için tablo
-- Bu tablo uygulama puanlama linklerini dinamik olarak sunar

CREATE TABLE IF NOT EXISTS app_links (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android')),
    country_code VARCHAR(10) NOT NULL DEFAULT 'tr',
    app_store_url TEXT NOT NULL,
    bundle_id VARCHAR(100),
    app_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Benzersiz platform-country kombinasyonu için index
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_links_platform_country 
ON app_links(platform, country_code) WHERE is_active = true;

-- Updated_at otomatik güncelleme trigger'ı
CREATE OR REPLACE FUNCTION update_app_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_app_links_updated_at_trigger
    BEFORE UPDATE ON app_links
    FOR EACH ROW
    EXECUTE FUNCTION update_app_links_updated_at();

-- Örnek veriler (Diress uygulaması için)
INSERT INTO app_links (platform, country_code, app_store_url, bundle_id, app_name) VALUES 
-- iOS App Store (farklı ülkeler)
('ios', 'tr', 'https://apps.apple.com/tr/app/diress-ai-outfit-try-on/id6738030797', 'com.diress.app', 'Diress: AI Outfit Try-On'),
('ios', 'us', 'https://apps.apple.com/us/app/diress-ai-outfit-try-on/id6738030797', 'com.diress.app', 'Diress: AI Outfit Try-On'),
('ios', 'global', 'https://apps.apple.com/app/diress-ai-outfit-try-on/id6738030797', 'com.diress.app', 'Diress: AI Outfit Try-On'),

-- Android Google Play Store
('android', 'tr', 'https://play.google.com/store/apps/details?id=com.diress.app&hl=tr', 'com.diress.app', 'Diress: AI Outfit Try-On'),
('android', 'us', 'https://play.google.com/store/apps/details?id=com.diress.app&hl=en', 'com.diress.app', 'Diress: AI Outfit Try-On'),
('android', 'global', 'https://play.google.com/store/apps/details?id=com.diress.app', 'com.diress.app', 'Diress: AI Outfit Try-On')

ON CONFLICT (platform, country_code) WHERE is_active = true 
DO UPDATE SET 
    app_store_url = EXCLUDED.app_store_url,
    bundle_id = EXCLUDED.bundle_id,
    app_name = EXCLUDED.app_name,
    updated_at = NOW();

-- Kolay sorgu için view
CREATE OR REPLACE VIEW active_app_links AS
SELECT 
    platform,
    country_code,
    app_store_url,
    bundle_id,
    app_name,
    created_at,
    updated_at
FROM app_links 
WHERE is_active = true
ORDER BY platform, country_code;

COMMENT ON TABLE app_links IS 'Uygulama store linklerini platform ve ülke bazında yönetir';
COMMENT ON COLUMN app_links.platform IS 'ios veya android';
COMMENT ON COLUMN app_links.country_code IS 'Ülke kodu (tr, us, global vb.)';
COMMENT ON COLUMN app_links.app_store_url IS 'Store link URL''si';
COMMENT ON COLUMN app_links.bundle_id IS 'Uygulama bundle/package ID''si';
