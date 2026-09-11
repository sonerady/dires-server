-- Kit görsel sağlayıcı seçimi (SimpleImageModal kitleri).
-- 'gpt' (varsayılan): GPT Image 2.5 medium, hata olursa Nano Banana 2 → pro.
-- 'nb2': Nano Banana 2 önce, hata olursa GPT Image 2.5.
-- Sunucu 60 sn önbellekler (src/utils/kitImageRoute.js), deploy gerekmez.
alter table app_config add column if not exists kit_route text not null default 'gpt';
comment on column app_config.kit_route is 'Kit image provider: gpt (GPT Image 2.5 medium, NB2 fallback) | nb2 (Nano Banana 2 first, GPT 2.5 fallback)';
alter table app_config add constraint app_config_kit_route_check check (kit_route in ('gpt','nb2'));
