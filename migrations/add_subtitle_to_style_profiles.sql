-- Stil profili kartlarında başlığın altında görünen kısa Gemini alt başlığı.
-- Kullanıcının uygulama dilinde tek bir metin olarak tutulur.
ALTER TABLE style_profiles ADD COLUMN IF NOT EXISTS subtitle TEXT;
