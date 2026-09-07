-- Inherits the existing service-role-only access and RLS on support conversations.
alter table public.support_conversations add column support_context jsonb;
comment on column public.support_conversations.support_context is 'Initial request diagnostics and server-verified account identity; owner inbox only.';
