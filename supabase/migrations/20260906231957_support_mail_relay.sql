-- Support routing data is private to the backend service role.
create table public.support_conversations (
  id uuid primary key,
  customer_email text not null,
  subject text not null,
  request_hash text,
  agent_token text not null unique,
  customer_token text not null unique,
  last_customer_message_id text,
  last_agent_message_id text,
  created_at timestamptz not null default now()
);
create table public.support_mail_deliveries (
  id text primary key,
  status text not null default 'pending' check (status in ('pending','processing','sent','ignored','review')),
  lock_token uuid,
  locked_until timestamptz,
  first_attempt_at timestamptz,
  payload jsonb,
  provider_id text,
  reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.support_conversations enable row level security;
alter table public.support_mail_deliveries enable row level security;
revoke all on public.support_conversations, public.support_mail_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.support_conversations, public.support_mail_deliveries to service_role;

create function public.claim_support_mail(delivery_id text, lease_token uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.support_mail_deliveries;
begin
  insert into public.support_mail_deliveries(id) values(delivery_id) on conflict do nothing;
  select * into d from public.support_mail_deliveries where id = delivery_id for update;
  if d.status in ('sent','ignored','review') then return to_jsonb(d); end if;
  if d.locked_until > now() then return null; end if;
  -- Resend only deduplicates for 24h. An ambiguous older send requires review.
  if d.first_attempt_at < now() - interval '23 hours' then
    update public.support_mail_deliveries set status = 'review', reason = 'idempotency_window_expired'
      where id = delivery_id returning * into d;
    return to_jsonb(d);
  end if;
  update public.support_mail_deliveries set status = 'processing', lock_token = lease_token,
    locked_until = now() + interval '3 minutes'
    where id = delivery_id returning * into d;
  return to_jsonb(d);
end;
$$;
revoke all on function public.claim_support_mail(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_support_mail(text,uuid) to service_role;
