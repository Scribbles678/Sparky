create table public.webhook_requests (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  webhook_secret text null,
  exchange text null,
  action text null,
  symbol text null,
  payload jsonb null,
  status text not null default 'pending'::text,
  error_message text null,
  processed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  strategy_id uuid null,
  constraint webhook_requests_pkey primary key (id),
  constraint webhook_requests_strategy_id_fkey foreign KEY (strategy_id) references strategies (id) on delete set null,
  constraint webhook_requests_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_webhook_requests_user_id on public.webhook_requests using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_webhook_requests_created_at on public.webhook_requests using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_webhook_requests_user_created on public.webhook_requests using btree (user_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_webhook_requests_status on public.webhook_requests using btree (status) TABLESPACE pg_default;

create index IF not exists idx_webhook_requests_strategy_id on public.webhook_requests using btree (strategy_id) TABLESPACE pg_default
where
  (strategy_id is not null);

create index IF not exists idx_webhook_requests_user_strategy on public.webhook_requests using btree (user_id, strategy_id) TABLESPACE pg_default
where
  (strategy_id is not null);