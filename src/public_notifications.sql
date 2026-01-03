-- 1. Create public_notifications table if not exists
CREATE TABLE IF NOT EXISTS public_notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title_json JSONB NOT NULL,
  desc_json JSONB NOT NULL,
  icon_type TEXT DEFAULT 'bell',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add detail_json column IF it doesn't exist (Fixes the error you saw)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='public_notifications' AND column_name='detail_json') THEN
        ALTER TABLE public_notifications ADD COLUMN detail_json JSONB;
    END IF;
END $$;

-- 3. Table to track which user has read which public notification
CREATE TABLE IF NOT EXISTS user_read_public_notifications (
  user_id UUID NOT NULL,
  notification_id UUID NOT NULL REFERENCES public_notifications(id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (user_id, notification_id)
);

-- 4. Seed data (UPSERT logic to avoid duplicates if re-run)
-- Note: This is a simple insert. If you want to avoid duplicates on re-run, 
-- you might want to TRUNCATE or use a specific identifier.
INSERT INTO public_notifications (title_json, desc_json, detail_json, icon_type) VALUES
(
  '{"tr": "Hoş Geldiniz!", "en": "Welcome!", "de": "Willkommen!"}', 
  '{"tr": "Yeni nesil AI moda modelinizi oluşturmaya başlayın.", "en": "Start creating your next generation AI fashion model.", "de": "Beginnen Sie mit der Erstellung Ihres KI-Modemodells der nächsten Generation."}', 
  '{"tr": "Diress dünyasına katıldığınız için teşekkürler. Panelimizi kullanarak ürünlerinizi profesyonel modeller üzerinde saniyeler içinde görebilirsiniz.", "en": "Thank you for joining the Diress world. Using our panel, you can see your products on professional models in seconds.", "de": "Vielen Dank, dass Sie sich der Diress-Welt angeschlossen haben. Mit unserem Panel können Sie Ihre Produkte in Sekundenschnelle an professionellen Modellen sehen."}',
  'bell'
),
(
  '{"tr": "Takı Modelleme Yayında!", "en": "Jewelry Modeling is Live!", "de": "Schmuckmodellierung ist online!"}', 
  '{"tr": "Artık takılarınızı gerçekçi modeller üzerinde sergileyebilirsiniz.", "en": "You can now showcase your jewelry on realistic models.", "de": "Sie können Ihren Schmuck jetzt an realistischen Modellen präsentieren."}', 
  '{"tr": "Yeni Takı Modelleme aracımızla yüzük, kolye ve küpelerinizi gerçek insan modelleri üzerinde yüksek çözünürlükte oluşturun.", "en": "Create your rings, necklaces, and earrings on real human models in high resolution with our new Jewelry Modeling tool.", "de": "Erstellen Sie Ihre Ringe, Halsketten und Ohrringe an echten menschlichen Modellen in hoher Auflösung mit unserem neuen Schmuckmodellierungstool."}',
  'sparkles'
),
(
  '{"tr": "Hediye Krediler!", "en": "Gift Credits!", "de": "Geschenkguthaben!"}', 
  '{"tr": "Hesabınıza 10 adet başlangıç kredisi tanımlandı.", "en": "10 starting credits have been defined to your account.", "de": "Ihrem Konto wurden 10 Startguthaben gutgeschrieben."}', 
  '{"tr": "Hemen denemeniz için 10 kredi hesabınıza yüklendi. Bu kredileri herhangi bir flowda kullanabilirsiniz.", "en": "10 credits have been loaded into your account for you to try immediately. You can use these credits in any flow.", "de": "Ihrem Konto wurden 10 Credits zum sofortigen Ausprobieren gutgeschrieben. Sie können diese Guthaben in jedem Flow verwenden."}',
  'zap'
),
(
  '{"tr": "Sistem Güncellemesi", "en": "System Update", "de": "Systemaktualisierung"}', 
  '{"tr": "Daha hızlı oluşturma için sunucularımız güncellendi.", "en": "Our servers have been updated for faster generation.", "de": "Unsere Server wurden für eine schnellere Generierung aktualisiert."}', 
  '{"tr": "Altyapımızda yaptığımız iyileştirmeler sayesinde bekleme sürelerini %30 oranında azalttık. Keyifli çalışmalar!", "en": "Thanks to the improvements we made in our infrastructure, we have reduced waiting times by 30%. Happy working!", "de": "Dank der Verbesserungen an unserer Infrastruktur konnten wir die Wartezeiten um 30 % reduzieren. Fröhliches Schaffen!"}',
  'settings'
);
