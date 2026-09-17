-- 🛍️ Listing Stüdyosu: bir işin kareleri tek insert ile yazıldığı için hepsi
-- aynı created_at değerini alıyor ve sıralama belirsiz kalıyordu. Aynı türden
-- birden fazla kare (ör. lifestyle ×3) gelince bu sıra kopya numaralarını da
-- bozuyor. frame_index = işin içindeki mutlak sıra, variant_index = o türün
-- kaçıncı kopyası (0 tabanlı).
alter table public.listing_studio_results
  add column if not exists frame_index integer not null default 0,
  add column if not exists variant_index integer not null default 0;

create index if not exists listing_studio_results_job_frame_idx
  on public.listing_studio_results (job_id, frame_index);
