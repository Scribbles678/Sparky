create table public.bot_credentials (
  id uuid not null default gen_random_uuid (),
  label text not null,
  exchange text not null,
  environment text null default 'production'::text,
  account_id text null,
  api_key text null,
  api_secret text null,
  passphrase text null,
  webhook_secret text null,
  extra_metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  user_id uuid null,
  last_tested timestamp with time zone null,
  constraint bot_credentials_pkey primary key (id),
  constraint bot_credentials_user_exchange_env_unique unique (user_id, exchange, environment),
  constraint bot_credentials_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists bot_credentials_exchange_idx on public.bot_credentials using btree (exchange) TABLESPACE pg_default;

create index IF not exists idx_bot_credentials_user_id on public.bot_credentials using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_bot_credentials_user_exchange_env on public.bot_credentials using btree (user_id, exchange, environment) TABLESPACE pg_default;

create index IF not exists idx_bot_credentials_last_tested on public.bot_credentials using btree (last_tested desc) TABLESPACE pg_default;