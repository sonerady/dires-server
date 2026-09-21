-- 🍽️ Menü stüdyosu (18 Eyl 2026) — restoranlara yemek menüsü hazırlama ekranı.
-- Admin panelindeki "Menü stüdyosu" sayfasının veri katmanı. Tasarımı GPT-6 Astra
-- üretir (fal → openrouter/router/vision), operatör baskı önizlemesinde metinleri
-- düzenler. Tamamen dahili: RLS açık, policy yok → yalnız service role erişir.

create table if not exists admin_menu_projects (
  id uuid primary key default gen_random_uuid(),
  restaurant_name text not null,
  subtitle text,
  cuisine text,
  -- Menü metinlerinin dili (ISO 639-1) ve para birimi simgesi
  language text not null default 'tr',
  currency text not null default '₺',
  page_size text not null default 'A4' check (page_size in ('A4','A5','US_LETTER','SQUARE')),
  notes text,
  -- Astra'nın ürettiği ve operatörün düzenlediği menü HTML'i (tek dosya, gömülü CSS)
  html text,
  html_generated_at timestamptz,
  model text,
  -- draft: henüz üretilmedi · researching: fotoğraf/araştırma sürüyor
  -- generating: tasarım üretiliyor · ready: hazır · error: hata
  status text not null default 'draft'
    check (status in ('draft','researching','generating','ready','error')),
  error_message text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_menu_projects_updated_idx on admin_menu_projects (archived, updated_at desc);

create table if not exists admin_menu_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin_menu_projects(id) on delete cascade,
  name text not null,
  description text,
  price text,
  category text,
  -- Yüklenen ya da internetten bulunup yeniden barındırılan görsel
  image_url text,
  image_source text check (image_source in ('upload','web')),
  image_credit text,
  -- Astra'nın araştırma notu (isim düzeltmesi, içerik bilgisi)
  research_note text,
  position double precision not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_menu_items_project_idx on admin_menu_items (project_id, position);

-- Her üretim/kaydetme bir sürüm bırakır; operatör geri dönebilir
create table if not exists admin_menu_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin_menu_projects(id) on delete cascade,
  html text not null,
  label text,
  created_at timestamptz not null default now()
);
create index if not exists admin_menu_revisions_project_idx on admin_menu_revisions (project_id, created_at desc);

create or replace function public.admin_menu_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_menu_projects_touch on admin_menu_projects;
create trigger admin_menu_projects_touch before update on admin_menu_projects
  for each row execute function public.admin_menu_touch_updated_at();
drop trigger if exists admin_menu_items_touch on admin_menu_items;
create trigger admin_menu_items_touch before update on admin_menu_items
  for each row execute function public.admin_menu_touch_updated_at();

alter table admin_menu_projects enable row level security;
alter table admin_menu_items enable row level security;
alter table admin_menu_revisions enable row level security;

-- Model seçimi deploy gerektirmeden değişsin (kit_route / gpt25_quality deseni)
alter table app_config add column if not exists menu_studio_model text default 'openai/gpt-6-astra';

-- ── 18 Eyl 2026 (kullanıcı geri bildirimi): tasarım seçenekleri ──
-- İlk üretimler fazla "klasik liste" çıkıyordu. Operatör artık fiyat/kategori/
-- açıklama/fotoğraf görünürlüğünü ve tasarım yönünü seçebiliyor; prompt da
-- çağdaş, tasarlanmış bir parça talep edecek şekilde yeniden yazıldı.
alter table admin_menu_projects
  add column if not exists show_prices boolean not null default true,
  add column if not exists show_descriptions boolean not null default true,
  add column if not exists category_mode text not null default 'auto',
  add column if not exists photo_mode text not null default 'auto',
  add column if not exists design_direction text not null default 'modern',
  add column if not exists density text not null default 'balanced',
  add column if not exists accent_color text;

alter table admin_menu_projects drop constraint if exists admin_menu_projects_category_mode_check;
alter table admin_menu_projects add constraint admin_menu_projects_category_mode_check
  check (category_mode in ('auto','grouped','flat'));
alter table admin_menu_projects drop constraint if exists admin_menu_projects_photo_mode_check;
alter table admin_menu_projects add constraint admin_menu_projects_photo_mode_check
  check (photo_mode in ('auto','rich','sparse','none'));
alter table admin_menu_projects drop constraint if exists admin_menu_projects_design_direction_check;
alter table admin_menu_projects add constraint admin_menu_projects_design_direction_check
  check (design_direction in ('free','modern','bold','minimal','dark','warm','playful'));
alter table admin_menu_projects drop constraint if exists admin_menu_projects_density_check;
alter table admin_menu_projects add constraint admin_menu_projects_density_check
  check (density in ('airy','balanced','dense'));

-- ── 18 Eyl 2026: örnek (referans) tasarım görseli + AI ile yemek fotoğrafı ──
-- Operatör beğendiği bir menü tasarımını yükleyip "buna benzesin" diyebiliyor
-- (Astra referansı GÖRÜR — vision geçidi). Fotoğrafı olmayan yemekler için
-- fal'da GPT Image 2.5 Sunburst text-to-image (quality: medium) ile görsel üretilir.
alter table admin_menu_projects
  add column if not exists reference_image_url text,
  add column if not exists reference_note text;

alter table admin_menu_items drop constraint if exists admin_menu_items_image_source_check;
alter table admin_menu_items add constraint admin_menu_items_image_source_check
  check (image_source in ('upload','web','ai'));

-- ── 18 Eyl 2026: örneğe sadakat düzeyi ──
-- İlk denemede referans görsel verilmesine rağmen sistem promptundaki
-- "jenerik menü şablonu üretme" yasağı + design_direction brief'i referansı
-- eziyordu. Artık referans varsa O birincil talimat; sadakat düzeyi seçilebilir.
alter table admin_menu_projects
  add column if not exists reference_strength text not null default 'close';
alter table admin_menu_projects drop constraint if exists admin_menu_projects_reference_strength_check;
alter table admin_menu_projects add constraint admin_menu_projects_reference_strength_check
  check (reference_strength in ('loose','close','strict'));

-- ── 18 Eyl 2026: tasarım öğeleri (arka plan/doku/ornament) + sayfa sürekliliği ──
-- Referans menüde arka plan görselleri, dokular, süslemeler olabiliyor. Astra
-- referansı görüp hangi öğelerin gerektiğini yazıyor, her biri GPT Image 2.5 ile
-- üretilip depomuza alınıyor, sonra tasarım adımına "şu rolde şu görsel var"
-- diye veriliyor. page_continuity: sayfalar bağımsız durmasın (bir görselin
-- yarısı bir sayfada, devamı diğerinde gibi).
create table if not exists admin_menu_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin_menu_projects(id) on delete cascade,
  role text not null default 'ornament',
  label text,
  prompt text,
  usage_note text,
  image_url text not null,
  transparent boolean not null default false,
  aspect text,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists admin_menu_assets_project_idx on admin_menu_assets (project_id, position);
alter table admin_menu_assets enable row level security;
alter table admin_menu_assets drop constraint if exists admin_menu_assets_role_check;
alter table admin_menu_assets add constraint admin_menu_assets_role_check
  check (role in ('background','texture','ornament','divider','cover','spot'));

alter table admin_menu_projects
  add column if not exists page_continuity boolean not null default true;

-- ── 18 Eyl 2026: hedef sayfa sayısı ──
-- Süreklilik kuralı ancak çok sayfalı menüde anlamlı; 14 yemek tek A4'e sığınca
-- model tek sayfa üretiyordu. Operatör artık hedefi seçebiliyor.
alter table admin_menu_projects
  add column if not exists page_target text not null default 'auto';
alter table admin_menu_projects drop constraint if exists admin_menu_projects_page_target_check;
alter table admin_menu_projects add constraint admin_menu_projects_page_target_check
  check (page_target in ('auto','single','spread','booklet'));

-- ── 18 Eyl 2026: referansın FOTOĞRAF STİLİ ──
-- Örnek menüdeki yemek fotoğraflarının ışığı/zemini/kadrajı/rengi Astra
-- tarafından çözümlenip photo_style'a yazılır; yeni üretilen fotoğraflar bu
-- stille üretilir, mevcutlar GPT Image 2.5 edit ile bu stile getirilir.
-- original_image_url: stil uygulanmadan önceki hâl (geri alınabilsin).
alter table admin_menu_projects
  add column if not exists photo_style text;
alter table admin_menu_items
  add column if not exists styled boolean not null default false,
  add column if not exists original_image_url text;

-- ── 18 Eyl 2026: kesme (cut-out) yemek fotoğrafı + otomatik stil uyarlama ──
-- Kırmızı/krem dalgalı örnek menüde yemekler TEPEDEN çekilmiş ve arka planı
-- olmayan kesme görseller olarak zemine oturuyordu. Stil analizi artık bunu
-- ayrı bir bayrak olarak döndürüyor; kesme ise GPT Image 2.5 doğrudan
-- background:"transparent" + PNG ile üretiyor (sonradan arka plan silme yok).
-- auto_photo_style: örnek varsa tasarımdan önce fotoğraflar kendiliğinden uyarlanır.
alter table admin_menu_projects
  add column if not exists photo_cutout boolean not null default false,
  add column if not exists auto_photo_style boolean not null default true;

-- ── 18 Eyl 2026: stil sürümleme + fotoğraf yenileme kipi + katman düzeyi spec ──
-- HATA: `styled` bayrağı bir kez true olunca YENİ bir örnek tasarım yüklendiğinde
-- de "zaten uyarlanmış" sayılıyor ve eski açıdaki (ör. yandan) fotoğraflar yeni
-- tasarıma taşınıyordu. Çözüm: projede style_version, kalemde styled_version.
-- Referans değişince sürüm artar, tüm fotoğraflar yeniden uyarlanması gereken
-- duruma düşer. photo_refresh_mode: mevcut fotoğraftan mı yola çıkılsın
-- ('restyle') yoksa sıfırdan mı üretilsin ('regenerate'), ya da dokunulmasın ('keep').
-- design_spec: referansın katman katman çözümlenmiş JSON künyesi.
alter table admin_menu_projects
  add column if not exists photo_refresh_mode text not null default 'restyle',
  add column if not exists style_version integer not null default 1,
  add column if not exists design_spec jsonb;
alter table admin_menu_projects drop constraint if exists admin_menu_projects_photo_refresh_mode_check;
alter table admin_menu_projects add constraint admin_menu_projects_photo_refresh_mode_check
  check (photo_refresh_mode in ('restyle','regenerate','keep'));

alter table admin_menu_items
  add column if not exists styled_version integer not null default 0,
  add column if not exists style_check text;

-- ── 18 Eyl 2026: düzenleme geçmişi (birikimli geri bildirim) ──
-- HATA: her /generate çağrısı yalnızca son geri bildirimi modele veriyordu;
-- "içindekiler ve fiyatlar yazılsın" gibi önceki istekler bir sonraki küçük
-- düzenlemede kayboluyordu. Çözüm: istekler feedback_log'da birikiyor ve her
-- üretimde tamamı "hâlâ geçerli talimatlar" olarak modele gidiyor.
-- Ayrıca düzenlemeler artık mevcut HTML üzerinden yapılıyor (revize kipi), böylece
-- her istekte tasarım baştan çizilmiyor ve görünüm tutarlı kalıyor.
alter table admin_menu_projects
  add column if not exists feedback_log jsonb not null default '[]'::jsonb;

-- Yapısal tasarım ayarı (yön, sayfa boyutu, referans, yoğunluk…) değişince tam
-- yeniden tasarım gerekir; içerik anahtarları (fiyat/açıklama) revize kipiyle
-- çözülür. Bu bayrak hangisinin gerektiğini söyler.
alter table admin_menu_projects
  add column if not exists redesign_pending boolean not null default false;

-- ── 18 Eyl 2026: hazır menü stilleri (menu_styles) ile bağ ──
-- Operatör artık her seferinde örnek görsel yüklemek zorunda değil: "Menü
-- stilleri" sayfasında biriken hazır stillerden (yemek / tatlı / içecek /
-- kahvaltı / şarap) birini seçiyor. Seçilen stilin TÜM görselleri referans
-- olarak kullanılıyor — tek kapak yerine menünün her sayfası modele gidiyor.
alter table admin_menu_projects
  add column if not exists menu_style_id uuid,
  add column if not exists reference_image_urls jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'admin_menu_projects_menu_style_id_fkey'
  ) then
    alter table admin_menu_projects
      add constraint admin_menu_projects_menu_style_id_fkey
      foreign key (menu_style_id) references menu_styles(id) on delete set null;
  end if;
end $$;
