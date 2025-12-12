create table public.tradier_option_trades (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  status text null default 'pending'::text,
  strategy text null,
  underlying_symbol text not null,
  option_symbol text not null,
  option_type text null,
  strike_price numeric(18, 4) null,
  expiration_date date null,
  contract_size integer null default 100,
  quantity_contracts numeric(18, 4) null,
  entry_order_id text null,
  tp_order_id text null,
  sl_order_id text null,
  time_exit_order_id text null,
  entry_order jsonb null,
  tp_leg jsonb null,
  sl_leg jsonb null,
  time_exit_order jsonb null,
  entry_limit_price numeric(18, 8) null,
  tp_limit_price numeric(18, 8) null,
  sl_stop_price numeric(18, 8) null,
  sl_limit_price numeric(18, 8) null,
  cost_usd numeric(18, 4) null,
  pnl_usd numeric(18, 4) null,
  pnl_percent numeric(18, 4) null,
  config_snapshot jsonb null default '{}'::jsonb,
  extra_metadata jsonb null default '{}'::jsonb,
  user_id uuid null,
  constraint tradier_option_trades_pkey primary key (id),
  constraint tradier_option_trades_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_tradier_option_trades_status on public.tradier_option_trades using btree (status) TABLESPACE pg_default;

create index IF not exists idx_tradier_option_trades_option_symbol on public.tradier_option_trades using btree (option_symbol) TABLESPACE pg_default;

create index IF not exists idx_tradier_option_trades_user_id on public.tradier_option_trades using btree (user_id) TABLESPACE pg_default;