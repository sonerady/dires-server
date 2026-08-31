-- 🎨 Banner stil havuzu (26 Ağu 2026)
-- CreateModelPhoto'daki stil eklentisi mantığının banner karşılığı: havuzdaki
-- her kayıt REFERANS BİR BANNER GÖRSELİ. Kullanıcı stili seçince üretim HTML
-- hattına değil nano-banana-2/edit'e gider: referans banner + kullanıcının
-- ürün fotoğrafı → üründeki kare değişir, metin/fiyat kampanya verisiyle
-- güncellenir. bkz. bannerStudioRoutes.js (styleId akışı).
CREATE TABLE IF NOT EXISTS banner_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  -- Referans banner görseli (aynı zamanda seçim kartındaki önizleme)
  image_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banner_styles_active
  ON banner_styles (is_active, sort_order);
