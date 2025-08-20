-- Mevcut tüm location kayıtlarını outdoor yap (tek seferlik)
UPDATE custom_locations 
SET location_type = 'outdoor' 
WHERE location_type IS NULL OR location_type = 'unknown';

-- Güncellenen kayıt sayısını göster
SELECT COUNT(*) as updated_count FROM custom_locations WHERE location_type = 'outdoor';
