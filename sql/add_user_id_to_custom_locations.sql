-- Custom Locations tablosuna user_id column'unu ekle (UUID type)
ALTER TABLE custom_locations 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- User ID için index ekle (performance için)
CREATE INDEX IF NOT EXISTS idx_custom_locations_user_id 
ON custom_locations(user_id);

-- RLS (Row Level Security) politikalarını güncelle

-- Eski politikaları sil (eğer varsa) - ÖNCE BU KOMUTLARI ÇALIŞTIRın
DROP POLICY IF EXISTS "Public locations are viewable by everyone" ON custom_locations;
DROP POLICY IF EXISTS "Users can view their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can create their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can update their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Users can delete their own locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can create locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can view locations" ON custom_locations;
DROP POLICY IF EXISTS "Anonymous users can view their locations" ON custom_locations;

-- Yeni güncellenmiş politikalar

-- 1. Public locations herkes görebilir
CREATE POLICY "Public locations are viewable by everyone" 
ON custom_locations FOR SELECT 
USING (is_public = true AND status = 'completed');

-- 2. Kullanıcılar kendi location'larını görebilir
CREATE POLICY "Users can view their own locations" 
ON custom_locations FOR SELECT 
USING (user_id IS NOT NULL AND user_id = auth.uid()::text);

-- 3. Kullanıcılar kendi location'larını oluşturabilir
CREATE POLICY "Users can create their own locations" 
ON custom_locations FOR INSERT 
WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid()::text);

-- 4. Kullanıcılar kendi location'larını güncelleyebilir
CREATE POLICY "Users can update their own locations" 
ON custom_locations FOR UPDATE 
USING (user_id IS NOT NULL AND user_id = auth.uid()::text);

-- 5. Kullanıcılar kendi location'larını silebilir
CREATE POLICY "Users can delete their own locations" 
ON custom_locations FOR DELETE 
USING (user_id IS NOT NULL AND user_id = auth.uid()::text);

-- 6. Anonymous/test kullanıcılar için geçici policy (development için)
CREATE POLICY "Anonymous users can create locations" 
ON custom_locations FOR INSERT 
WITH CHECK (user_id IS NOT NULL);

CREATE POLICY "Anonymous users can view their locations" 
ON custom_locations FOR SELECT 
USING (user_id IS NOT NULL);

-- Mevcut kayıtları test user_id ile güncelle (opsiyonel)
-- UPDATE custom_locations 
-- SET user_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'::UUID 
-- WHERE user_id IS NULL;

-- Tablo yapısını kontrol et
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'custom_locations' 
ORDER BY ordinal_position;
