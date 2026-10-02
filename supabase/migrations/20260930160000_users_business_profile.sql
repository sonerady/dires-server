-- 🏪 İşletme profili (30 Eyl 2026): Kolaj / PDF Katalog ekranlarında girilen mağaza bilgileri
-- (storeName, website, phone, email, social, address, whatsapp) kullanıcı hesabında saklanır ve
-- ekranlar her açılışta bunlarla dolar. Yalnız API (service_role) yazar/okur: GET/PUT /api/business-profile.
-- Salt ekleme: eski istemciler bu sütunu hiç görmez; varsayılan '{}' ile mevcut satırlar etkilenmez.
alter table public.users
  add column if not exists business_profile jsonb not null default '{}'::jsonb;

-- Yalnız düz bir JSON nesnesi, küçük boyutlu (7 alan × ≤200 karakter). NOT VALID: mevcut satırların
-- hepsi '{}' — tabloyu tarayıp kilit tutmaya gerek yok; yeni yazımlar yine denetlenir.
alter table public.users
  drop constraint if exists users_business_profile_object;
alter table public.users
  add constraint users_business_profile_object
  check (jsonb_typeof(business_profile) = 'object' and pg_column_size(business_profile) < 8192) not valid;

comment on column public.users.business_profile is
  'Seller business info used by Collage / Catalog PDF (storeName, website, phone, email, social, address, whatsapp). Written only via /api/business-profile.';
