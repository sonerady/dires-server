-- Diress AI HTML Modal Örnekleri
-- Bu SQL kodlarını Supabase SQL Editor'da çalıştırabilirsin

-- 1. Hoş Geldin Modal (Herkese göster)
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  content
) VALUES (
  true,
  'all',
  NULL,
  1,
  NOW(),
  '{
    "tr": {
      "title": "🚀 Diress AI''ya Hoş Geldiniz",
      "html": "<div style=\"text-align: center; margin-bottom: 20px;\"><h1 style=\"color: #6366F1; margin-bottom: 10px;\">🎨 Yapay Zeka Destekli Moda</h1><p style=\"color: #666; font-size: 18px;\">Geleceğin moda deneyimini yaşayın</p></div><div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;\"><h3 style=\"margin-top: 0; color: white;\">✨ Özellikler</h3><ul style=\"margin: 0; padding-left: 20px;\"><li style=\"margin-bottom: 8px;\"><strong>AI Model Fotoğrafçılığı</strong></li><li style=\"margin-bottom: 8px;\"><strong>Renk Değiştirme</strong></li><li style=\"margin-bottom: 8px;\"><strong>Saç Stili Değiştirme</strong></li><li><strong>HD Kalite</strong></li></ul></div><div style=\"text-align: center; margin: 20px 0;\"><img src=\"https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=250&fit=crop\" alt=\"AI Fashion\" style=\"width: 100%; max-width: 400px; border-radius: 12px;\"/></div><div style=\"background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎁 Özel Fırsat</h4><p style=\"color: #92400e; margin-bottom: 0;\">İlk 100 kullanıcıya <strong>50 ücretsiz kredi</strong>!</p></div>"
    },
    "en": {
      "title": "🚀 Welcome to Diress AI",
      "html": "<div style=\"text-align: center; margin-bottom: 20px;\"><h1 style=\"color: #6366F1; margin-bottom: 10px;\">🎨 AI-Powered Fashion</h1><p style=\"color: #666; font-size: 18px;\">Experience the future of fashion</p></div><div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;\"><h3 style=\"margin-top: 0; color: white;\">✨ Features</h3><ul style=\"margin: 0; padding-left: 20px;\"><li style=\"margin-bottom: 8px;\"><strong>AI Model Photography</strong></li><li style=\"margin-bottom: 8px;\"><strong>Color Changing</strong></li><li style=\"margin-bottom: 8px;\"><strong>Hair Style Changing</strong></li><li><strong>HD Quality</strong></li></ul></div><div style=\"text-align: center; margin: 20px 0;\"><img src=\"https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=250&fit=crop\" alt=\"AI Fashion\" style=\"width: 100%; max-width: 400px; border-radius: 12px;\"/></div><div style=\"background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎁 Special Offer</h4><p style=\"color: #92400e; margin-bottom: 0;\"><strong>50 free credits</strong> for first 100 users!</p></div>"
    }
  }'::jsonb
);

-- 2. Premium Tanıtım Modal (Kayıtlı kullanıcılara)
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  end_date,
  content
) VALUES (
  true,
  'registered',
  NULL,
  2,
  NOW(),
  NOW() + INTERVAL '30 days',
  '{
    "tr": {
      "title": "🛍️ Premium Özellikler",
      "html": "<div style=\"background: linear-gradient(45deg, #ff6b6b, #ffa726); color: white; padding: 20px; border-radius: 15px; text-align: center; margin-bottom: 20px;\"><h2 style=\"margin: 0; font-size: 24px;\">🌟 Premium Deneyim</h2></div><div style=\"display: grid; gap: 15px;\"><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">👗 Sanal Giyinme</h4><p style=\"color: #666; margin-bottom: 0;\">Kıyafetleri satın almadan önce deneyin</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">🎨 Sınırsız Renk</h4><p style=\"color: #666; margin-bottom: 0;\">İstediğiniz renkte kişiselleştirin</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">📸 4K Kalite</h4><p style=\"color: #666; margin-bottom: 0;\">Profesyonel kalite görüntüler</p></div></div><div style=\"text-align: center; margin: 20px 0;\"><a href=\"#\" style=\"display: inline-block; background-color: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;\">🚀 Hemen Başla</a></div><hr style=\"border: none; height: 1px; background-color: #e0e0e0; margin: 20px 0;\"><p style=\"text-align: center; color: #888; font-size: 14px; margin: 0;\">💰 İlk ay sadece <strong style=\"color: #ff6b6b;\">9.99₺</strong></p>"
    },
    "en": {
      "title": "🛍️ Premium Features",
      "html": "<div style=\"background: linear-gradient(45deg, #ff6b6b, #ffa726); color: white; padding: 20px; border-radius: 15px; text-align: center; margin-bottom: 20px;\"><h2 style=\"margin: 0; font-size: 24px;\">🌟 Premium Experience</h2></div><div style=\"display: grid; gap: 15px;\"><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">👗 Virtual Try-On</h4><p style=\"color: #666; margin-bottom: 0;\">Try clothes before buying</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">🎨 Unlimited Colors</h4><p style=\"color: #666; margin-bottom: 0;\">Personalize in any color</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">📸 4K Quality</h4><p style=\"color: #666; margin-bottom: 0;\">Professional quality images</p></div></div><div style=\"text-align: center; margin: 20px 0;\"><a href=\"#\" style=\"display: inline-block; background-color: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;\">🚀 Get Started</a></div><hr style=\"border: none; height: 1px; background-color: #e0e0e0; margin: 20px 0;\"><p style=\"text-align: center; color: #888; font-size: 14px; margin: 0;\">💰 First month only <strong style=\"color: #ff6b6b;\">$2.99</strong></p>"
    }
  }'::jsonb
);

-- 3. Sistem Duyurusu Modal (Anonim kullanıcılara)
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  end_date,
  content
) VALUES (
  true,
  'anonymous',
  NULL,
  5,
  NOW(),
  NOW() + INTERVAL '7 days',
  '{
    "tr": {
      "title": "📢 Önemli Duyuru",
      "html": "<div style=\"background-color: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 20px;\"><div style=\"display: flex; align-items: center; margin-bottom: 15px;\"><span style=\"background-color: #ef4444; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold;\">!</span><h3 style=\"margin: 0; color: #dc2626;\">Sistem Güncellemesi</h3></div><p style=\"color: #7f1d1d; margin-bottom: 15px;\">Bu hafta sonu yeni özellikler için sistem güncellemesi yapılacak.</p><ul style=\"color: #7f1d1d; margin: 0; padding-left: 20px;\"><li>Güncelleme: Cumartesi 02:00 - 06:00</li><li>Yeni özellikler Pazar aktif olacak</li><li>Verileriniz güvende kalacak</li></ul></div><div style=\"background-color: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 20px;\"><h4 style=\"color: #166534; margin-top: 0;\">🎁 Güncelleme Hediyesi</h4><p style=\"color: #166534; margin-bottom: 0;\">Güncelleme sonrası tüm kullanıcılara <strong>25 bonus kredi</strong> hediye!</p></div>"
    },
    "en": {
      "title": "📢 Important Notice",
      "html": "<div style=\"background-color: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 20px;\"><div style=\"display: flex; align-items: center; margin-bottom: 15px;\"><span style=\"background-color: #ef4444; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold;\">!</span><h3 style=\"margin: 0; color: #dc2626;\">System Update</h3></div><p style=\"color: #7f1d1d; margin-bottom: 15px;\">System update for new features this weekend.</p><ul style=\"color: #7f1d1d; margin: 0; padding-left: 20px;\"><li>Update: Saturday 02:00 - 06:00</li><li>New features active on Sunday</li><li>Your data will be safe</li></ul></div><div style=\"background-color: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 20px;\"><h4 style=\"color: #166534; margin-top: 0;\">🎁 Update Gift</h4><p style=\"color: #166534; margin-bottom: 0;\">After update, all users get <strong>25 bonus credits</strong>!</p></div>"
    }
  }'::jsonb
);

-- 4. Belirli Kullanıcı Modal Örneği
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  content
) VALUES (
  true,
  'specific_users',
  '["b74bf3f3-188e-44c8-95aa-b4985b36bbba"]'::jsonb,
  1,
  NOW(),
  '{
    "tr": {
      "title": "👑 VIP Kullanıcı",
      "html": "<div style=\"background: linear-gradient(45deg, #8B5CF6, #EC4899); color: white; padding: 25px; border-radius: 20px; text-align: center; margin-bottom: 25px;\"><h1 style=\"margin: 0; font-size: 28px;\">👑 VIP Erişim</h1><p style=\"margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;\">Özel beta tester ayricalıkları</p></div><div style=\"background-color: #f8fafc; border-radius: 15px; padding: 20px; margin: 20px 0;\"><h3 style=\"color: #1a202c; margin-top: 0;\">🚀 Beta Özellikleri</h3><div style=\"display: grid; gap: 12px;\"><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #8B5CF6;\"><strong style=\"color: #8B5CF6;\">AI Video Generation</strong><br><span style=\"color: #666; font-size: 14px;\">Statik fotoğrafları videoya çevirin</span></div><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #EC4899;\"><strong style=\"color: #EC4899;\">Advanced Pose Control</strong><br><span style=\"color: #666; font-size: 14px;\">Model pozlarını tam kontrol edin</span></div><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #10B981;\"><strong style=\"color: #10B981;\">Priority Processing</strong><br><span style=\"color: #666; font-size: 14px;\">İşlemleriniz öncelikli olarak yapılır</span></div></div></div><div style=\"background-color: #fef3c7; border-radius: 12px; padding: 20px; border: 2px solid #f59e0b;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎯 Beta Feedback</h4><p style=\"color: #92400e; margin-bottom: 0;\">Geri bildirimleriniz çok değerli! Test ettiğiniz özellikleri <strong>feedback@diress.ai</strong> adresine yazın.</p></div>"
    },
    "en": {
      "title": "👑 VIP User",
      "html": "<div style=\"background: linear-gradient(45deg, #8B5CF6, #EC4899); color: white; padding: 25px; border-radius: 20px; text-align: center; margin-bottom: 25px;\"><h1 style=\"margin: 0; font-size: 28px;\">👑 VIP Access</h1><p style=\"margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;\">Exclusive beta tester privileges</p></div><div style=\"background-color: #f8fafc; border-radius: 15px; padding: 20px; margin: 20px 0;\"><h3 style=\"color: #1a202c; margin-top: 0;\">🚀 Beta Features</h3><div style=\"display: grid; gap: 12px;\"><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #8B5CF6;\"><strong style=\"color: #8B5CF6;\">AI Video Generation</strong><br><span style=\"color: #666; font-size: 14px;\">Convert static photos to videos</span></div><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #EC4899;\"><strong style=\"color: #EC4899;\">Advanced Pose Control</strong><br><span style=\"color: #666; font-size: 14px;\">Full control over model poses</span></div><div style=\"background: white; padding: 12px; border-radius: 8px; border-left: 4px solid #10B981;\"><strong style=\"color: #10B981;\">Priority Processing</strong><br><span style=\"color: #666; font-size: 14px;\">Your requests get priority processing</span></div></div></div><div style=\"background-color: #fef3c7; border-radius: 12px; padding: 20px; border: 2px solid #f59e0b;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎯 Beta Feedback</h4><p style=\"color: #92400e; margin-bottom: 0;\">Your feedback is valuable! Send your feature tests to <strong>feedback@diress.ai</strong></p></div>"
    }
  }'::jsonb
); 