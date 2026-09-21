alter table public.credit_refund_requests
 add column if not exists notification_attempts integer not null default 0,
 add column if not exists notification_next_retry_at timestamptz;
create index if not exists credit_refund_notification_queue on public.credit_refund_requests(notification_status,notification_next_retry_at) where status='refunded' and notification_status in ('pending','failed');
