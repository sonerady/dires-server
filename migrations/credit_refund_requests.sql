-- 💳 Kredi iadesi (15 Eyl 2026): SimpleImageModal'daki "Kredi iadesi" butonu.
-- Ürün fotoğrafları + sonuç, etiketli şeritlerle Gemini'ye gönderilir; ürün birebir değilse
-- ya da görsel bozuksa kredi otomatik iade edilir. Üretim başına TEK istek (unique).
create table if not exists credit_refund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  generation_id text not null,
  result_image_url text,
  product_image_urls jsonb not null default '[]'::jsonb,
  analysis_image_urls jsonb not null default '[]'::jsonb,
  credits_deducted integer not null default 0,
  status text not null default 'analyzing' check (status in ('analyzing','refunded','rejected','error')),
  verdict text,
  product_match integer,
  render_quality integer,
  confidence numeric(4,3),
  refund_percent integer not null default 0,
  refunded_credits integer not null default 0,
  defects jsonb not null default '[]'::jsonb,
  summary text,
  language_code text,
  model text,
  raw_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, generation_id)
);
create index if not exists credit_refund_requests_user_created_idx on credit_refund_requests (user_id, created_at desc);

-- Atomik kredi iadesi (deduct_user_credit aynası)
create or replace function public.refund_user_credit(user_id uuid, credit_amount integer)
returns json language plpgsql as $$
declare
  current_balance integer;
  new_balance integer;
begin
  if credit_amount is null or credit_amount <= 0 then
    return json_build_object('success', false, 'error', 'Invalid amount');
  end if;
  select credit_balance into current_balance from users where id = user_id for update;
  if not found then
    return json_build_object('success', false, 'error', 'User not found');
  end if;
  new_balance := coalesce(current_balance, 0) + credit_amount;
  update users set credit_balance = new_balance where id = user_id;
  return json_build_object('success', true, 'error', null, 'current_balance', current_balance, 'new_balance', new_balance, 'refunded_amount', credit_amount);
exception when others then
  return json_build_object('success', false, 'error', SQLERRM);
end;
$$;

alter table app_config
  add column if not exists refund_enabled boolean not null default true,
  add column if not exists refund_daily_limit integer not null default 3,
  add column if not exists refund_max_age_days integer not null default 14;
