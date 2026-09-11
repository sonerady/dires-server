-- "Yenilikler" sayfa-modalı (güncelleme sonrası). Uzaktan yönetim: app_config (platform satırı başına).
alter table app_config
  add column if not exists whats_new_enabled boolean not null default false,
  add column if not exists whats_new_version text,
  add column if not exists whats_new_audience text not null default 'updated',
  add column if not exists whats_new_dismissible boolean not null default true,
  add column if not exists whats_new_platforms jsonb not null default '["ios","android","desktop","web"]'::jsonb,
  add column if not exists whats_new_title jsonb not null default '{}'::jsonb,
  add column if not exists whats_new_html jsonb not null default '{}'::jsonb;
alter table app_config add constraint app_config_whats_new_audience_check check (whats_new_audience in ('updated','all'));
comment on column app_config.whats_new_enabled is 'Yenilikler sayfa-modalı açık mı (false → uzaktan kapatır, açık modal da kapanır)';
comment on column app_config.whats_new_version is 'Modalın ait olduğu sürüm (ör. 1.7.8). Kullanıcı bu sürümü bir kez görür.';
comment on column app_config.whats_new_audience is 'updated: yalnız güncelleme yapan (önceki sürümü olan) kullanıcılar · all: sürümü görmemiş herkes';
comment on column app_config.whats_new_dismissible is 'true: X / aşağı kaydır / geri ile kapatılabilir · false: sadece alt buton';
comment on column app_config.whats_new_platforms is 'Gösterilecek istemciler: ios, android, desktop (Mac shell), web';
comment on column app_config.whats_new_title is 'Dil → başlık ({"default":"...","tr":"...","en":"..."})';
comment on column app_config.whats_new_html is 'Dil → HTML gövdesi ({"default":"<h2>…","tr":"…","en":"…"}); fallback: dil → ana dil → default → en';
-- İstemci güncelleme tespiti için önceki sürüm
alter table users add column if not exists previous_app_version text;
