-- ============================================================================
--  app_config: Sanal Manken çekim modu kontrolleri
--  Tarih: 2026-08-11
-- ============================================================================
--
--  İKİ AYRI ŞALTER. Karıştırılmamalı:
--
--  1) create_model_start_modal_enabled  → ARAYÜZ şalteri
--     Ana ekranda Sanal Manken kartına basınca ön kapı modalı (Kristal / Kanvas
--     seçimi) çıksın mı?
--        true  → modal çıkar, kullanıcı modunu kendi seçer
--        false → modal HİÇ çıkmaz, doğrudan KANVAS modunda üretim ekranına gidilir
--                (istek `autoStyleEnabled: false` taşır)
--
--  2) auto_global_style_enabled          → SUNUCU ana şalteri
--     Gizli global stil ("house style") atama sistemi çalışsın mı?
--        true  → normal çalışır
--        false → HİÇBİR YERDE kullanılmaz; kullanıcı Kristal'i seçse bile
--                sunucu stil atamaz, üretim sade akışına döner
--
--  Not: 1 kapalıyken 2 açık olabilir — o durumda kimse Kristal'i seçemez ama
--  parametresiz gelen eski istemciler (deeplink, eski build) hâlâ otomatik stil
--  alır. Sistemi tamamen durdurmak için 2'yi false yap.
--
--  ⚠️ 2'nin env karşılığı da var: AUTO_GLOBAL_STYLE=false. Env AÇIKÇA
--  ayarlanmışsa o kazanır (acil durum kill switch'i, deploy gerektirmeden
--  Railway'den kapatmak için). DB kolonu normal operasyon içindir.
-- ============================================================================

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS create_model_start_modal_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_global_style_enabled        boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN app_config.create_model_start_modal_enabled IS
  'Ana ekranda Sanal Manken kartına basınca çekim modu seçim modalı (Kristal/Kanvas) gösterilsin mi? false ise modal atlanır ve doğrudan Kanvas modunda devam edilir.';

COMMENT ON COLUMN app_config.auto_global_style_enabled IS
  'Gizli global stil (house style) atama sisteminin ana şalteri. false ise hiçbir üretimde otomatik stil atanmaz. env AUTO_GLOBAL_STYLE açıkça ayarlanmışsa o önceliklidir.';


-- ── Mevcut satırları görüntüle (migration sonrası doğrulama) ──────────────
SELECT platform,
       create_model_start_modal_enabled,
       auto_global_style_enabled,
       trial_enabled,
       paywall_pricing_version
FROM   app_config
ORDER BY platform;


-- ============================================================================
--  KULLANIM ÖRNEKLERİ — çalıştırma, ihtiyaç oldukça kopyala
-- ============================================================================
--
-- Ön kapıyı KAPAT (herkes doğrudan Kanvas modunda üretsin):
--   UPDATE app_config SET create_model_start_modal_enabled = false;
--
-- Ön kapıyı yalnız iOS'ta aç:
--   UPDATE app_config SET create_model_start_modal_enabled = (platform = 'ios');
--
-- Otomatik global stili TAMAMEN durdur (acil):
--   UPDATE app_config SET auto_global_style_enabled = false;
--
-- İkisini de geri aç:
--   UPDATE app_config SET create_model_start_modal_enabled = true,
--                         auto_global_style_enabled = true;
