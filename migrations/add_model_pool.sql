-- Model havuzu (10 Eyl 2026): eklentiyle Pinterest'ten kırpılan kişi fotoğraflarından
-- üretilen ORTAK modeller. Her kullanıcıya cinsiyet başına 3 model rastgele ve
-- KALICI olarak atanır (model_pool_assignments); atanan model kullanıcının
-- user_models kitaplığına kopyalanır (replicate_id = pool:<pool_id>:<user_id>:<slot>).
create table if not exists public.model_pool (
  id serial primary key,
  name text not null,
  gender text not null check (gender in ('woman','man')),
  age text not null default 'young',
  image_url text not null,
  original_image_url text,
  model_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(model_profile) = 'object'),
  source text not null default 'clipper',
  source_fingerprint text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists model_pool_gender_active_idx on public.model_pool (gender, active, id);

create table if not exists public.model_pool_assignments (
  user_id uuid not null references public.users(id) on delete cascade,
  gender text not null check (gender in ('woman','man')),
  slot smallint not null check (slot >= 0 and slot <= 2),
  pool_model_id integer not null references public.model_pool(id) on delete cascade,
  user_model_id integer references public.user_models(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, gender, slot)
);

-- Karıştırmada daha önce gösterilen modeller tekrar gelmesin (havuz tükenince sıfırlanır).
create table if not exists public.model_pool_history (
  user_id uuid not null references public.users(id) on delete cascade,
  pool_model_id integer not null references public.model_pool(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, pool_model_id)
);

alter table public.model_pool enable row level security;
alter table public.model_pool_assignments enable row level security;
alter table public.model_pool_history enable row level security;
-- Yalnız service-role (sunucu) erişir; istemci politikası yok.

-- 10 Eyl 2026 (2): 70 dilde isim + yeniden işleme damgası; kopyalar da isimleri taşır.
alter table public.model_pool add column if not exists names jsonb not null default '{}'::jsonb;
alter table public.model_pool add column if not exists reprocessed_at timestamptz;
alter table public.user_models add column if not exists names jsonb;
