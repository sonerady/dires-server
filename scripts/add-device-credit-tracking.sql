-- Users tablosuna device_id bazlı kredi kontrolü için yeni column'lar ekle
-- Bu script device_id ile tek seferlik 100 kredi kontrol sistemi kuracak

-- 1. Device ID column'u ekle (eğer yoksa)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);

-- 2. Device için ilk kredi alım durumu
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS received_initial_credit BOOLEAN DEFAULT FALSE;

-- 3. Device'ın ilk kredi aldığı tarih
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS initial_credit_date TIMESTAMP WITH TIME ZONE;

-- 4. Performans için index'ler oluştur
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
CREATE INDEX IF NOT EXISTS idx_users_received_initial_credit ON users(received_initial_credit);
CREATE INDEX IF NOT EXISTS idx_users_device_credit_combo ON users(device_id, received_initial_credit);

-- 5. Mevcut kullanıcıları güncelle - zaten kredit_balance > 0 olanları işaretle
UPDATE users 
SET received_initial_credit = TRUE,
    initial_credit_date = created_at
WHERE credit_balance >= 100 
  AND received_initial_credit IS FALSE;

-- 6. Güvenlik için constraint ekle - device_id unique olmasın (bir cihazda birden fazla user olabilir)
-- Ama aynı device_id için sadece bir kez initial_credit = TRUE olabilir

-- 7. Function: Device için kredi alım kontrolü
CREATE OR REPLACE FUNCTION check_device_credit_eligibility(device_id_param VARCHAR(255))
RETURNS TABLE (
    can_receive_credit BOOLEAN,
    existing_user_count INTEGER,
    last_credit_date TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    user_count INTEGER;
    last_date TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Bu device_id ile kaç kullanıcı initial credit almış?
    SELECT COUNT(*), MAX(initial_credit_date)
    INTO user_count, last_date
    FROM users 
    WHERE device_id = device_id_param 
      AND received_initial_credit = TRUE;
    
    -- Eğer bu device_id ile henüz kimse kredi almamışsa TRUE döndür
    RETURN QUERY SELECT 
        (user_count = 0) as can_receive_credit,
        user_count as existing_user_count,
        last_date as last_credit_date;
END;
$$ LANGUAGE plpgsql;

-- 8. Mevcut tablo yapısını kontrol et
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
    AND column_name IN ('device_id', 'received_initial_credit', 'initial_credit_date')
ORDER BY column_name;

-- 9. Test: Function'ı test et
SELECT * FROM check_device_credit_eligibility('test-device-id-123');

-- 10. Mevcut kullanıcı istatistikleri
SELECT 
    COUNT(*) as total_users,
    COUNT(CASE WHEN device_id IS NOT NULL THEN 1 END) as users_with_device_id,
    COUNT(CASE WHEN received_initial_credit = TRUE THEN 1 END) as users_received_credit,
    COUNT(CASE WHEN credit_balance >= 100 THEN 1 END) as users_with_100plus_credits
FROM users;

-- 11. Device bazlı istatistikler
SELECT 
    device_id,
    COUNT(*) as user_count,
    COUNT(CASE WHEN received_initial_credit = TRUE THEN 1 END) as credit_received_count,
    MAX(initial_credit_date) as last_credit_date,
    STRING_AGG(id::text, ', ') as user_ids
FROM users 
WHERE device_id IS NOT NULL
GROUP BY device_id
HAVING COUNT(*) > 1  -- Aynı device_id'ye sahip birden fazla kullanıcı varsa göster
ORDER BY user_count DESC;
