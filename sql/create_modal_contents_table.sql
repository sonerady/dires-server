-- Modal içerikleri tablosu
CREATE TABLE IF NOT EXISTS modal_contents (
  id SERIAL PRIMARY KEY,
  modal_key VARCHAR(100) UNIQUE NOT NULL, -- modal'ın benzersiz anahtarı (örn: 'results_tips', 'maintenance_notice')
  content JSONB NOT NULL, -- çoklu dil içeriği (en, tr, de, es, fr, it, ja, ko, pt, ru, zh)
  is_active BOOLEAN DEFAULT true, -- modal aktif mi?
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Örnek veri ekle
INSERT INTO modal_contents (modal_key, content, is_active) VALUES 
(
  'results_tips',
  '{
    "en": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Photo quality is crucial for best results!</strong> Use proper photography techniques for AI to work perfectly.</p></div><div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0;\"><div style=\"padding: 16px; border-radius: 12px; text-align: center; background-color: #ecfdf5; border: 2px solid #10b981;\"><div style=\"font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #059669;\">✅ Good Examples</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">📐</span> Straight front view</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🏃‍♀️</span> On mannequin</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">💡</span> Good lighting</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🎯</span> Clean & sharp</div></div><div style=\"padding: 16px; border-radius: 12px; text-align: center; background-color: #fef2f2; border: 2px solid #ef4444;\"><div style=\"font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #dc2626;\">❌ Bad Examples</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">👤</span> Side view</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🌫️</span> Blurry photo</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🌃</span> Dark environment</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">✂️</span> Cropped image</div></div></div><h2 style=\"color: #1e40af; font-size: 22px; margin-top: 30px; margin-bottom: 16px; font-weight: 600;\">🔧 Technical Tips</h2><ul style=\"padding-left: 20px;\"><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">📱</span> Hold phone vertically</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">🔍</span> Minimum 1080p resolution</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">🎨</span> Pay attention to color contrast</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">📏</span> Show complete garment</li></ul><div style=\"background-color: #fef3c7; padding: 16px; border-radius: 12px; border-left: 4px solid #f59e0b; margin: 20px 0; text-align: center;\"><strong>⚡ Pro Tip:</strong> Flat lay photos give the best results!</div><h2 style=\"color: #1e40af; font-size: 22px; margin-top: 30px; margin-bottom: 16px; font-weight: 600;\">🎯 Quality Control</h2><ul style=\"padding-left: 20px;\"><li style=\"margin-bottom: 8px; color: #4b5563;\">Check photo sharpness</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Minimize shadows and reflections</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Ensure product details are visible</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Keep background clean and simple</li></ul><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Follow these tips to get amazing results!</p></div>"
    },
    "tr": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 En iyi sonuclar icin fotograf kalitesi cok onemli!</strong> AI nin mukemmel calismasi icin dogru fotograf tekniklerini kullanin.</p></div><div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0;\"><div style=\"padding: 16px; border-radius: 12px; text-align: center; background-color: #ecfdf5; border: 2px solid #10b981;\"><div style=\"font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #059669;\">✅ Iyi Ornekler</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">📐</span> Duz on gorus</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🏃‍♀️</span> Mannequin uzerinde</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">💡</span> Iyi aydinlatma</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🎯</span> Net ve temiz</div></div><div style=\"padding: 16px; border-radius: 12px; text-align: center; background-color: #fef2f2; border: 2px solid #ef4444;\"><div style=\"font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #dc2626;\">❌ Kotu Ornekler</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">👤</span> Yan gorus</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🌫️</span> Bulanik fotograf</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">🌃</span> Karanlik ortam</div><div style=\"margin: 8px 0; padding: 8px; border-radius: 8px; background-color: rgba(255,255,255,0.7);\"><span style=\"font-size: 20px; margin-right: 8px;\">✂️</span> Kesilmis goruntu</div></div></div><h2 style=\"color: #1e40af; font-size: 22px; margin-top: 30px; margin-bottom: 16px; font-weight: 600;\">🔧 Teknik Ipuclari</h2><ul style=\"padding-left: 20px;\"><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">📱</span> Telefonu dik tutun</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">🔍</span> Minimum 1080p cozunurluk</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">🎨</span> Renk kontrastina dikkat edin</li><li style=\"margin-bottom: 8px; color: #4b5563;\"><span style=\"font-size: 20px; margin-right: 8px;\">📏</span> Kiyafetin tamamini gosterin</li></ul><div style=\"background-color: #fef3c7; padding: 16px; border-radius: 12px; border-left: 4px solid #f59e0b; margin: 20px 0; text-align: center;\"><strong>⚡ Pro Ipucu:</strong> Flat lay (duz zemin) fotograflari en iyi sonuclari verir!</div><h2 style=\"color: #1e40af; font-size: 22px; margin-top: 30px; margin-bottom: 16px; font-weight: 600;\">🎯 Kalite Kontrol</h2><ul style=\"padding-left: 20px;\"><li style=\"margin-bottom: 8px; color: #4b5563;\">Fotograf netlik kontrolu yapin</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Golge ve yansimalari minimalize edin</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Urunun detaylarinin gorunur oldugunden emin olun</li><li style=\"margin-bottom: 8px; color: #4b5563;\">Arka plan temiz ve sade olsun</li></ul><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Bu ipuclarini takip ederek harika sonuclar elde edebilirsiniz!</p></div>"
    },
    "de": {
      "title": "💡 Ergebnis-Tipps & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Ergebnis-Tipps & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Fotoqualitat ist entscheidend fur beste Ergebnisse!</strong> Verwenden Sie richtige Fototechniken, damit KI perfekt funktioniert.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Folgen Sie diesen Tipps fur erstaunliche Ergebnisse!</p></div>"
    },
    "es": {
      "title": "💡 Consejos y Trucos de Resultados",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Consejos y Trucos de Resultados</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 La calidad de la foto es crucial para mejores resultados!</strong> Use tecnicas fotograficas adecuadas para que la IA funcione perfectamente.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Siga estos consejos para obtener resultados increibles!</p></div>"
    },
    "fr": {
      "title": "💡 Conseils et Astuces de Resultats",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Conseils et Astuces de Resultats</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 La qualite photo est cruciale pour de meilleurs resultats!</strong> Utilisez les bonnes techniques photographiques pour que l IA fonctionne parfaitement.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Suivez ces conseils pour obtenir des resultats incroyables!</p></div>"
    },
    "it": {
      "title": "💡 Suggerimenti e Trucchi sui Risultati",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Suggerimenti e Trucchi sui Risultati</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 La qualita della foto e cruciale per i migliori risultati!</strong> Usa tecniche fotografiche appropriate affinche l IA funzioni perfettamente.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Segui questi suggerimenti per ottenere risultati fantastici!</p></div>"
    },
    "ja": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Photo quality is crucial for best results!</strong> Use proper photography techniques for AI to work perfectly.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Follow these tips to get amazing results!</p></div>"
    },
    "ko": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Photo quality is crucial for best results!</strong> Use proper photography techniques for AI to work perfectly.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Follow these tips to get amazing results!</p></div>"
    },
    "pt": {
      "title": "💡 Dicas e Truques de Resultados",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Dicas e Truques de Resultados</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 A qualidade da foto e crucial para melhores resultados!</strong> Use tecnicas fotograficas adequadas para que a IA funcione perfeitamente.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Siga essas dicas para obter resultados incriveis!</p></div>"
    },
    "ru": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Photo quality is crucial for best results!</strong> Use proper photography techniques for AI to work perfectly.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Follow these tips to get amazing results!</p></div>"
    },
    "zh": {
      "title": "💡 Results Tips & Tricks",
      "html": "<h1 style=\"color: #2563EB; font-size: 28px; margin-bottom: 20px; text-align: center; font-weight: 700;\">💡 Results Tips & Tricks</h1><div style=\"background-color: #f0f9ff; padding: 16px; border-radius: 12px; border-left: 4px solid #2563EB; margin-bottom: 24px;\"><p><strong>📸 Photo quality is crucial for best results!</strong> Use proper photography techniques for AI to work perfectly.</p></div><div style=\"background-color: #f8fafc; padding: 20px; border-radius: 12px; text-align: center; margin-top: 30px; margin-bottom: 80px;\"><p style=\"font-size: 18px; color: #2563EB; margin: 0; font-weight: 600;\">🌟 Follow these tips to get amazing results!</p></div>"
    }
  }',
  true
),
(
  'maintenance_notice',
  '{
    "en": {
      "title": "⚙️ Maintenance in Progress",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporary Maintenance</h2><p>The system is currently under maintenance, so your recent result could not be generated correctly. This issue will be resolved within 1 hour. The credits used for this process will be refunded automatically to your account. Thank you for your understanding.</p>"
    },
    "tr": {
      "title": "⚙️ Sistem Bakimda",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Gecici Bakim</h2><p>Sistem su anda bakimda oldugu icin son gonderim nizden dogru sonuc alinamadi. Sorun 1 saat icinde cozulecek. Bu islem icin harcanan krediler hesabiniza otomatik olarak iade edilecektir. Anlayisiniz icin tesekkur ederiz.</p>"
    },
    "de": {
      "title": "⚙️ Wartung im Gange",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporare Wartung</h2><p>Das System ist derzeit in Wartung, daher konnte Ihr letztes Ergebnis nicht korrekt generiert werden. Dieses Problem wird innerhalb von 1 Stunde behoben. Die fur diesen Prozess verwendeten Kredite werden automatisch auf Ihr Konto zuruckerstattet.</p>"
    },
    "es": {
      "title": "⚙️ Mantenimiento en Progreso",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Mantenimiento Temporal</h2><p>El sistema esta actualmente en mantenimiento, por lo que su resultado reciente no pudo generarse correctamente. Este problema se resolvera dentro de 1 hora. Los creditos utilizados para este proceso se reembolsaran automaticamente a su cuenta.</p>"
    },
    "fr": {
      "title": "⚙️ Maintenance en Cours",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Maintenance Temporaire</h2><p>Le systeme est actuellement en maintenance, donc votre resultat recent n a pas pu etre genere correctement. Ce probleme sera resolu dans 1 heure. Les credits utilises pour ce processus seront automatiquement rembourses sur votre compte.</p>"
    },
    "it": {
      "title": "⚙️ Manutenzione in Corso",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Manutenzione Temporanea</h2><p>Il sistema e attualmente in manutenzione, quindi il tuo risultato recente non e stato generato correttamente. Questo problema sara risolto entro 1 ora. I crediti utilizzati per questo processo saranno automaticamente rimborsati sul tuo account.</p>"
    },
    "ja": {
      "title": "⚙️ Maintenance in Progress",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporary Maintenance</h2><p>The system is currently under maintenance, so your recent result could not be generated correctly. This issue will be resolved within 1 hour. The credits used for this process will be refunded automatically to your account.</p>"
    },
    "ko": {
      "title": "⚙️ Maintenance in Progress",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporary Maintenance</h2><p>The system is currently under maintenance, so your recent result could not be generated correctly. This issue will be resolved within 1 hour. The credits used for this process will be refunded automatically to your account.</p>"
    },
    "pt": {
      "title": "⚙️ Manutencao em Andamento",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Manutencao Temporaria</h2><p>O sistema esta atualmente em manutencao, entao seu resultado recente nao pode ser gerado corretamente. Este problema sera resolvido dentro de 1 hora. Os creditos usados para este processo serao reembolsados automaticamente em sua conta.</p>"
    },
    "ru": {
      "title": "⚙️ Maintenance in Progress",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporary Maintenance</h2><p>The system is currently under maintenance, so your recent result could not be generated correctly. This issue will be resolved within 1 hour. The credits used for this process will be refunded automatically to your account.</p>"
    },
    "zh": {
      "title": "⚙️ Maintenance in Progress",
      "html": "<h2 style=\"color:#d9534f;\">⚙️ Temporary Maintenance</h2><p>The system is currently under maintenance, so your recent result could not be generated correctly. This issue will be resolved within 1 hour. The credits used for this process will be refunded automatically to your account.</p>"
    }
  }',
  true
);

-- Güncelleme trigger'ı ekle
CREATE OR REPLACE FUNCTION update_modal_contents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_modal_contents_updated_at
  BEFORE UPDATE ON modal_contents
  FOR EACH ROW
  EXECUTE FUNCTION update_modal_contents_updated_at();

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_modal_contents_key ON modal_contents(modal_key);
CREATE INDEX IF NOT EXISTS idx_modal_contents_active ON modal_contents(is_active);
