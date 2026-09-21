-- 🗂️ Yönetim panosu (Kanban) — 17 Eyl 2026.
-- Admin panelindeki "Pano" sayfasının veri katmanı. Tamamen dahili: uygulama
-- istemcileri bu tabloları HİÇ görmez (RLS açık, policy yok → yalnız service
-- role erişir, sunucu adminKanbanRoutes üzerinden okur/yazar).
--
-- position alanları double precision: iki kart arasına bırakılınca komşuların
-- ortası hesaplanır (yeniden numaralandırma yok, tek satır update yeter).

create table if not exists admin_kanban_boards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  position double precision not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_kanban_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references admin_kanban_boards(id) on delete cascade,
  title text not null,
  position double precision not null default 0,
  wip_limit integer,
  -- true ise buraya taşınan kart "tamamlandı" sayılır (completed_at dolar)
  is_done boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_kanban_columns_board_idx on admin_kanban_columns (board_id, position);

create table if not exists admin_kanban_labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references admin_kanban_boards(id) on delete cascade,
  name text not null,
  -- renk anahtarı (arayüzdeki sabit palet): slate, red, amber, emerald, blue, violet, pink, teal
  color text not null default 'slate',
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists admin_kanban_labels_board_idx on admin_kanban_labels (board_id, position);

create table if not exists admin_kanban_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references admin_kanban_boards(id) on delete cascade,
  column_id uuid not null references admin_kanban_columns(id) on delete cascade,
  title text not null,
  description text,
  position double precision not null default 0,
  priority text check (priority in ('urgent','high','normal','low')),
  label_ids jsonb not null default '[]'::jsonb,
  assignee text,
  due_date date,
  -- [{id, text, done}]
  checklist jsonb not null default '[]'::jsonb,
  -- [{id, label, url}]
  links jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_kanban_cards_column_idx on admin_kanban_cards (column_id, position);
create index if not exists admin_kanban_cards_board_idx on admin_kanban_cards (board_id, archived);
create index if not exists admin_kanban_cards_due_idx on admin_kanban_cards (due_date) where archived = false;

create table if not exists admin_kanban_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references admin_kanban_cards(id) on delete cascade,
  author text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_kanban_comments_card_idx on admin_kanban_comments (card_id, created_at);

-- Kart geçmişi: taşıma, alan değişikliği, arşiv… (kart detayında zaman çizelgesi)
create table if not exists admin_kanban_activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references admin_kanban_boards(id) on delete cascade,
  card_id uuid references admin_kanban_cards(id) on delete cascade,
  type text not null,
  message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_kanban_activity_card_idx on admin_kanban_activity (card_id, created_at desc);
create index if not exists admin_kanban_activity_board_idx on admin_kanban_activity (board_id, created_at desc);

-- updated_at otomatik
create or replace function public.admin_kanban_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_kanban_boards_touch on admin_kanban_boards;
create trigger admin_kanban_boards_touch before update on admin_kanban_boards
  for each row execute function public.admin_kanban_touch_updated_at();
drop trigger if exists admin_kanban_columns_touch on admin_kanban_columns;
create trigger admin_kanban_columns_touch before update on admin_kanban_columns
  for each row execute function public.admin_kanban_touch_updated_at();
drop trigger if exists admin_kanban_cards_touch on admin_kanban_cards;
create trigger admin_kanban_cards_touch before update on admin_kanban_cards
  for each row execute function public.admin_kanban_touch_updated_at();

-- Dahili tablolar: anon/authenticated erişimi kapalı, service role bypass eder.
alter table admin_kanban_boards enable row level security;
alter table admin_kanban_columns enable row level security;
alter table admin_kanban_labels enable row level security;
alter table admin_kanban_cards enable row level security;
alter table admin_kanban_comments enable row level security;
alter table admin_kanban_activity enable row level security;
