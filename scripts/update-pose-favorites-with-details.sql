-- pose_favorites tablosuna pose detaylarını ekle
-- Bu sayede her favori için ayrı API çağrısı yapmaya gerek kalmaz

-- Yeni kolonları ekle
ALTER TABLE pose_favorites 
ADD COLUMN IF NOT EXISTS pose_title TEXT,
ADD COLUMN IF NOT EXISTS pose_image_url TEXT,
ADD COLUMN IF NOT EXISTS pose_key TEXT;

-- Index'leri ekle (performance için)
CREATE INDEX IF NOT EXISTS idx_pose_favorites_user_with_details 
ON pose_favorites(user_id, pose_type, created_at DESC);

-- Değişiklikleri kontrol et
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'pose_favorites' 
AND column_name IN ('pose_title', 'pose_image_url', 'pose_key')
ORDER BY column_name;

-- Mevcut kayıtları kontrol et
SELECT 
    pose_type,
    COUNT(*) as total_count,
    COUNT(pose_title) as with_title_count,
    COUNT(pose_image_url) as with_image_count
FROM pose_favorites
GROUP BY pose_type;
