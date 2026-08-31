-- 🎞️ Slot başına TEK görsel yerine 5 GÖRSEL (24 Ağu 2026, kullanıcı kararı)
--
-- 17 Ağu'da kart görselinin SABİT olması istenmişti ("değişmesin"). Karar
-- tersine çevrildi: monotonluktan kurtarmak için her slota en fazla 5 görsel
-- seçiliyor ve uygulama her açılışta bunlardan rastgele birini gösteriyor.
--
-- Tekillik artık (slot × görsel) üzerinde: aynı görsel bir slota iki kez
-- eklenemez, ama farklı görseller yan yana durabilir. 5 sınırı sunucuda
-- (styleProfileRouterFactory, MAX_CARDS_PER_SLOT) zorlanıyor.
--
-- ⚠️⚠️ ZAMAN AŞIMI ALIYORSANIZ: tablo 12 satır, işlem anlık olmalı — sorun
-- büyüklük değil KİLİT BEKLEMESİ. DROP INDEX, ACCESS EXCLUSIVE kilidi ister ve
-- tabloya dokunan açık bir işlem varsa sıraya girer; editör de beklerken kendi
-- zaman aşımına düşer. Aşağıdaki lock_timeout bunu 5 saniyede NET bir hataya
-- çevirir ("canceling statement due to lock timeout") — böylece sonsuz
-- beklemek yerine sebebi görürsünüz.
--
-- 📋 ADIM ADIM ÇALIŞTIRIN (hepsini birden değil, TEK TEK):
--    ADIM 1 → ADIM 2 → ADIM 3. Hangisinin takıldığı böyle anlaşılır.
--    ADIM 3 kilit hatası verirse: yerel dev sunucusunu (nodemon) durdurun,
--    açık SQL editörü sekmelerini kapatın ve ADIM 3'ü tekrar çalıştırın.

-- ─────────────────────────────────────────────────────────────
-- ADIM 1 — Oturum ayarları (sonsuz bekleme yerine hızlı, net hata)
-- ─────────────────────────────────────────────────────────────
SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────
-- ADIM 2 — ÖNCE yeni indeksi kur.
-- Eski indeks dururken de kurulabilir; ikisi bir süre yan yana yaşar.
-- Bu adım DROP'tan bağımsız, takılırsa sorun başka yerdedir.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS style_approach_cards_slot_image_idx
  ON style_approach_cards (
    product_category,
    coalesce(product_subtype, ''),
    coalesce(gender, ''),
    style_approach,
    image_url
  );

-- ─────────────────────────────────────────────────────────────
-- ADIM 3 — SONRA eski tekil indeksi düşür.
-- Asıl kısıtlama bu: slot başına tek satıra izin veriyor.
--
-- ⚠️ SET satırları burada TEKRARLANIYOR — bilerek. Supabase editöründe her
-- "Run" AYRI bir oturum; ADIM 1'deki ayarlar bu adımı tek başına
-- çalıştırdığınızda geçerli olmaz.
-- ─────────────────────────────────────────────────────────────
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DROP INDEX IF EXISTS style_approach_cards_slot_idx;

-- ─────────────────────────────────────────────────────────────
-- 🔍 TEŞHİS — ADIM 3 kilit hatası verirse bunu çalıştırın:
-- tabloyu kim tutuyor, hangi sorgu, ne zamandır?
-- ─────────────────────────────────────────────────────────────
-- SELECT a.pid, a.state, a.wait_event_type, a.wait_event,
--        now() - a.xact_start AS islem_suresi,
--        left(a.query, 90) AS sorgu
--   FROM pg_locks l
--   JOIN pg_stat_activity a ON a.pid = l.pid
--  WHERE l.relation = 'style_approach_cards'::regclass
--    AND a.pid <> pg_backend_pid()
--  ORDER BY a.xact_start;
--
-- ✅ DOĞRULAMA — iki indeksin durumu:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'style_approach_cards';
--   Beklenen son hâl: style_approach_cards_slot_image_idx VAR,
--                     style_approach_cards_slot_idx YOK.
