-- Örnek HTML Modal Oluşturma SQL Script
-- Diress Project Info Modal Sistemi

INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  end_date,
  content,
  created_at,
  updated_at
) VALUES (
  true,
  'all',
  NULL,
  1,
  NOW(),
  NULL,
  '{
    "tr": {
      "title": "🚀 Yeni Güncellemeler",
      "html": "<div style=\"text-align: center; margin-bottom: 20px;\"><h1 style=\"color: #6366F1; margin-bottom: 10px;\">🎨 Diress AI''ya Hoş Geldiniz!</h1><p style=\"color: #666; font-size: 18px;\">Yapay zeka destekli moda deneyiminin geleceği</p></div><div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;\"><h3 style=\"margin-top: 0; color: white;\">✨ Yeni Özellikler</h3><ul style=\"margin: 0; padding-left: 20px;\"><li style=\"margin-bottom: 8px;\"><strong>AI Model Fotoğrafçılığı:</strong> Ürünlerinizi profesyonel modeller üzerinde görün</li><li style=\"margin-bottom: 8px;\"><strong>Renk Değiştirme:</strong> Anlık renk dönüşümleri</li><li style=\"margin-bottom: 8px;\"><strong>Saç Stilı Değiştirme:</strong> 50+ farklı saç modeli</li><li><strong>HD Kalite:</strong> 4K çözünürlükte sonuçlar</li></ul></div><div style=\"background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #1a202c; margin-top: 0;\">💡 Pro İpucu</h4><p style=\"margin-bottom: 0; color: #4a5568;\">En iyi sonuçlar için <code style=\"background-color: #edf2f7; padding: 2px 6px; border-radius: 4px; font-family: monospace;\">yüksek çözünürlüklü</code> fotoğraflar kullanın!</p></div><div style=\"text-align: center; margin-top: 24px;\"><img src=\"https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=250&fit=crop&auto=format\" alt=\"AI Fashion\" style=\"width: 100%; max-width: 400px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);\"/></div><blockquote style=\"border-left: 4px solid #6366F1; padding-left: 16px; margin: 20px 0; font-style: italic; color: #6b7280;\">\"Teknoloji ve moda birleştiğinde sihir yaratılır\" - Diress AI Ekibi</blockquote><div style=\"background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎁 Özel Fırsat</h4><p style=\"color: #92400e; margin-bottom: 0;\">İlk 100 kullanıcıya <strong>50 ücretsiz kredi</strong>! Hemen başlayın ve AI''nın gücünü keşfedin.</p></div>"
    },
    "en": {
      "title": "🚀 New Updates",
      "html": "<div style=\"text-align: center; margin-bottom: 20px;\"><h1 style=\"color: #6366F1; margin-bottom: 10px;\">🎨 Welcome to Diress AI!</h1><p style=\"color: #666; font-size: 18px;\">The future of AI-powered fashion experience</p></div><div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;\"><h3 style=\"margin-top: 0; color: white;\">✨ New Features</h3><ul style=\"margin: 0; padding-left: 20px;\"><li style=\"margin-bottom: 8px;\"><strong>AI Model Photography:</strong> See your products on professional models</li><li style=\"margin-bottom: 8px;\"><strong>Color Changing:</strong> Instant color transformations</li><li style=\"margin-bottom: 8px;\"><strong>Hair Style Changing:</strong> 50+ different hair models</li><li><strong>HD Quality:</strong> 4K resolution results</li></ul></div><div style=\"background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #1a202c; margin-top: 0;\">💡 Pro Tip</h4><p style=\"margin-bottom: 0; color: #4a5568;\">For best results, use <code style=\"background-color: #edf2f7; padding: 2px 6px; border-radius: 4px; font-family: monospace;\">high-resolution</code> photos!</p></div><div style=\"text-align: center; margin-top: 24px;\"><img src=\"https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=250&fit=crop&auto=format\" alt=\"AI Fashion\" style=\"width: 100%; max-width: 400px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);\"/></div><blockquote style=\"border-left: 4px solid #6366F1; padding-left: 16px; margin: 20px 0; font-style: italic; color: #6b7280;\">\"When technology and fashion come together, magic is created\" - Diress AI Team</blockquote><div style=\"background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 20px 0;\"><h4 style=\"color: #92400e; margin-top: 0;\">🎁 Special Offer</h4><p style=\"color: #92400e; margin-bottom: 0;\"><strong>50 free credits</strong> for the first 100 users! Start now and discover the power of AI.</p></div>"
    }
  }'::jsonb,
  NOW(),
  NOW()
);

-- Başka bir örnek: Ürün tanıtımı modal
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  end_date,
  content,
  created_at,
  updated_at
) VALUES (
  true,
  'registered',
  NULL,
  2,
  NOW(),
  NOW() + INTERVAL '30 days',
  '{
    "tr": {
      "title": "🛍️ Moda Devrimi",
      "html": "<div style=\"background: linear-gradient(45deg, #ff6b6b, #ffa726); color: white; padding: 20px; border-radius: 15px; text-align: center; margin-bottom: 20px;\"><h2 style=\"margin: 0; font-size: 24px;\">🌟 Premium Özellikler</h2></div><div style=\"display: grid; gap: 15px;\"><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">👗 Sanal Giyinme</h4><p style=\"color: #666; margin-bottom: 0;\">Kıyafetleri satın almadan önce nasıl göründüğünü gör</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">🎨 Renk Paleti</h4><p style=\"color: #666; margin-bottom: 0;\">Sınırsız renk seçenekleri ile kişiselleştir</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">📸 HD Çıktı</h4><p style=\"color: #666; margin-bottom: 0;\">Profesyonel kalitede görüntüler</p></div></div><div style=\"text-align: center; margin: 20px 0;\"><a href=\"#\" style=\"display: inline-block; background-color: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;\">🚀 Hemen Dene</a></div><hr style=\"border: none; height: 1px; background-color: #e0e0e0; margin: 20px 0;\"><p style=\"text-align: center; color: #888; font-size: 14px; margin: 0;\">💰 İlk ay sadece <strong style=\"color: #ff6b6b;\">9.99₺</strong></p>"
    },
    "en": {
      "title": "🛍️ Fashion Revolution",
      "html": "<div style=\"background: linear-gradient(45deg, #ff6b6b, #ffa726); color: white; padding: 20px; border-radius: 15px; text-align: center; margin-bottom: 20px;\"><h2 style=\"margin: 0; font-size: 24px;\">🌟 Premium Features</h2></div><div style=\"display: grid; gap: 15px;\"><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">👗 Virtual Try-On</h4><p style=\"color: #666; margin-bottom: 0;\">See how clothes look before buying</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">🎨 Color Palette</h4><p style=\"color: #666; margin-bottom: 0;\">Personalize with unlimited color options</p></div><div style=\"background-color: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);\"><h4 style=\"color: #333; margin-top: 0;\">📸 HD Output</h4><p style=\"color: #666; margin-bottom: 0;\">Professional quality images</p></div></div><div style=\"text-align: center; margin: 20px 0;\"><a href=\"#\" style=\"display: inline-block; background-color: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;\">🚀 Try Now</a></div><hr style=\"border: none; height: 1px; background-color: #e0e0e0; margin: 20px 0;\"><p style=\"text-align: center; color: #888; font-size: 14px; margin: 0;\">💰 First month only <strong style=\"color: #ff6b6b;\">$2.99</strong></p>"
    }
  }'::jsonb,
  NOW(),
  NOW()
);

-- Duyuru modal örneği
INSERT INTO info_modals (
  is_active,
  target_audience,
  target_user_ids,
  priority,
  start_date,
  end_date,
  content,
  created_at,
  updated_at
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
      "html": "<div style=\"background-color: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 20px;\"><div style=\"display: flex; align-items: center; margin-bottom: 15px;\"><span style=\"background-color: #ef4444; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold;\">!</span><h3 style=\"margin: 0; color: #dc2626;\">Sistem Bakımı</h3></div><p style=\"color: #7f1d1d; margin-bottom: 15px;\">Bu hafta sonu (15-16 Haziran) sistem geliştirme çalışmaları yapılacaktır.</p><ul style=\"color: #7f1d1d; margin: 0; padding-left: 20px;\"><li>Bakım: Cumartesi 02:00 - 06:00</li><li>Yeni özellikler Pazar günü aktif olacak</li><li>Verileriniz güvende, kayıp olmayacak</li></ul></div><div style=\"background-color: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 20px;\"><h4 style=\"color: #166534; margin-top: 0;\">🎁 Bakım Sonrası Hediye</h4><p style=\"color: #166534; margin-bottom: 0;\">Sistem güncellemesi sonrası tüm kullanıcılara <strong>25 bonus kredi</strong> hediye edilecek!</p></div>"
    },
    "en": {
      "title": "📢 Important Announcement",
      "html": "<div style=\"background-color: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 20px;\"><div style=\"display: flex; align-items: center; margin-bottom: 15px;\"><span style=\"background-color: #ef4444; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold;\">!</span><h3 style=\"margin: 0; color: #dc2626;\">System Maintenance</h3></div><p style=\"color: #7f1d1d; margin-bottom: 15px;\">System development work will be carried out this weekend (June 15-16).</p><ul style=\"color: #7f1d1d; margin: 0; padding-left: 20px;\"><li>Maintenance: Saturday 02:00 - 06:00</li><li>New features will be active on Sunday</li><li>Your data is safe, no loss will occur</li></ul></div><div style=\"background-color: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 20px;\"><h4 style=\"color: #166534; margin-top: 0;\">🎁 Post-Maintenance Gift</h4><p style=\"color: #166534; margin-bottom: 0;\">After the system update, all users will receive <strong>25 bonus credits</strong> as a gift!</p></div>"
    }
  }'::jsonb,
  NOW(),
  NOW()
); 