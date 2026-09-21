-- Kanıt satırı (credit_refund_charges) kredi DÜŞÜLDÜĞÜ an yazılır; üretim o
-- sırada bitmediği için sonuç görseli henüz yoktur. result_image_url zorunlu
-- olduğu sürece satır hiç yazılamıyordu → tablo boş → claim_credit_refund'a
-- proof gelmiyor → credit_owner_id null → YZ'nin onayladığı her iade
-- review_pending'e düşüyordu. Kolon opsiyonel oluyor; RPC zaten
-- coalesce(proof.result_image_url, g.pre_upscale_image_url, g.result_image_url)
-- ile generation satırına düşüyor.
alter table public.credit_refund_charges alter column result_image_url drop not null;
alter table public.credit_refund_charges alter column product_image_urls set default '[]'::jsonb;
