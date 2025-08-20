-- custom_locations tablosuna location_type column'u ekle
ALTER TABLE custom_locations 
ADD COLUMN location_type VARCHAR(50) DEFAULT 'unknown';

-- Mevcut kayıtlar için location_type'ı güncelle (opsiyonel)
-- UPDATE custom_locations SET location_type = 'unknown' WHERE location_type IS NULL;

-- Index ekle (performans için)
CREATE INDEX idx_custom_locations_location_type ON custom_locations(location_type);

-- Enum değerleri için check constraint ekle
ALTER TABLE custom_locations 
ADD CONSTRAINT check_location_type 
CHECK (location_type IN ('outdoor', 'indoor', 'studio', 'unknown'));
