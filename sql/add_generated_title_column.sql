-- Custom Locations tablosuna generated_title column'unu ekle
ALTER TABLE custom_locations 
ADD COLUMN IF NOT EXISTS generated_title VARCHAR(255);

-- Generated title için index ekle (arama performansı için)
CREATE INDEX IF NOT EXISTS idx_custom_locations_generated_title 
ON custom_locations(generated_title);

-- Tablo yapısını kontrol et
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'custom_locations' 
AND column_name IN ('title', 'generated_title')
ORDER BY ordinal_position;
