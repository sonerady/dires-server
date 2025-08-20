-- custom_locations tablosundaki tüm is_public değerlerini true yap
UPDATE custom_locations
SET is_public = true
WHERE is_public IS NULL OR is_public = false;

-- Güncellenen kayıt sayısını göster
SELECT COUNT(*) as updated_count FROM custom_locations WHERE is_public = true;

-- Mevcut durumu kontrol et
SELECT 
    is_public,
    COUNT(*) as count
FROM custom_locations 
GROUP BY is_public;
