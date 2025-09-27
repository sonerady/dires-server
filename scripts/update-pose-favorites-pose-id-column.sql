-- Pose favorites tablosundaki pose_id kolonunu UUID'den TEXT'e değiştir
-- Çünkü default pose'lar integer ID kullanıyor (433, 434, etc.)

-- Önce mevcut constraintleri kontrol et
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'pose_favorites' AND constraint_type = 'UNIQUE';

-- Mevcut unique constraint'i kaldır (eğer varsa)
ALTER TABLE pose_favorites DROP CONSTRAINT IF EXISTS pose_favorites_user_id_pose_id_pose_type_key;

-- pose_id kolonunu TEXT tipine değiştir
ALTER TABLE pose_favorites ALTER COLUMN pose_id TYPE TEXT;

-- Unique constraint'i yeniden ekle
ALTER TABLE pose_favorites ADD CONSTRAINT pose_favorites_user_id_pose_id_pose_type_unique 
UNIQUE(user_id, pose_id, pose_type);

-- Değişikliği kontrol et
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'pose_favorites' AND column_name = 'pose_id';

-- Örnek veri kontrolü
SELECT pose_id, pose_type, COUNT(*) as count
FROM pose_favorites
GROUP BY pose_id, pose_type
ORDER BY pose_id;
