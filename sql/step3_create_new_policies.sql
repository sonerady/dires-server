-- STEP 3: Yeni policy'leri oluştur

-- 1. Public locations herkes görebilir
CREATE POLICY "Public locations viewable by everyone" 
ON custom_locations FOR SELECT 
USING (is_public = true AND status = 'completed');

-- 2. Kullanıcılar kendi location'larını görebilir
CREATE POLICY "Users view own locations" 
ON custom_locations FOR SELECT 
USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 3. Kullanıcılar kendi location'larını oluşturabilir
CREATE POLICY "Users create own locations" 
ON custom_locations FOR INSERT 
WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

-- 4. Kullanıcılar kendi location'larını güncelleyebilir
CREATE POLICY "Users update own locations" 
ON custom_locations FOR UPDATE 
USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 5. Kullanıcılar kendi location'larını silebilir
CREATE POLICY "Users delete own locations" 
ON custom_locations FOR DELETE 
USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 6. Anonymous/test kullanıcılar için geçici policy (development için)
CREATE POLICY "Anonymous create locations" 
ON custom_locations FOR INSERT 
WITH CHECK (user_id IS NOT NULL);

CREATE POLICY "Anonymous view locations" 
ON custom_locations FOR SELECT 
USING (user_id IS NOT NULL);
