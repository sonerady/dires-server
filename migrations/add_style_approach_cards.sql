-- 🎨 Çekim tarzı kartlarının VİTRİN görselleri (17 Ağu 2026, kullanıcı kararı)
--
-- Yükleme kartının altındaki 1/2/3 kartlarında hangi görselin duracağını admin
-- elle seçer; görsel SABİTTİR, kendiliğinden değişmez. Her satır tek bir slotu
-- temsil eder: (ürün tipi × alt tür × çekim tarzı).
--
-- product_subtype NULL = o kategorinin geneli (alt türü olmayan/eşleşmeyen ürün).
-- Sunucu önce tam eşleşmeyi (kategori+alt tür), sonra kategori genelini arar;
-- ikisi de yoksa havuzdan tek bir kare gösterir (kart asla boş kalmaz).
--
-- ⚠️ Bu migration çalıştırılmadan da uygulama çalışır: sunucu tablo yoksa
-- sessizce havuz görseline düşer, yalnız admin seçimi kaydedilemez.

create table if not exists style_approach_cards (
  id uuid primary key default gen_random_uuid(),
  product_category text not null,
  product_subtype  text,
  style_approach   smallint not null check (style_approach between 1 and 3),
  image_url        text not null,
  -- Görselin hangi havuz stilinden seçildiği (iz sürmek için; stil silinirse
  -- kart görseli kalmaya devam eder, bu alan boşalır).
  style_profile_id uuid references style_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bir slota tek görsel: aynı (kategori, alt tür, tarz) üçlüsü tekrar edemez.
-- coalesce ile NULL alt tür de tekilleştirmeye dahil edilir.
create unique index if not exists style_approach_cards_slot_idx
  on style_approach_cards (product_category, coalesce(product_subtype, ''), style_approach);

create index if not exists style_approach_cards_lookup_idx
  on style_approach_cards (product_category, style_approach);

-- Yalnız sunucu (service role) yazar; istemci bu tabloya doğrudan erişmez.
alter table style_approach_cards enable row level security;
