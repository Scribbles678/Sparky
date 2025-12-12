create table public.trades (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  symbol character varying(20) not null,
  side character varying(10) not null,
  entry_price numeric(20, 8) not null,
  entry_time timestamp with time zone not null,
  exit_price numeric(20, 8) not null,
  exit_time timestamp with time zone not null,
  quantity numeric(20, 8) not null,
  position_size_usd numeric(20, 2) not null,
  stop_loss_price numeric(20, 8) null,
  take_profit_price numeric(20, 8) null,
  stop_loss_percent numeric(10, 4) null,
  take_profit_percent numeric(10, 4) null,
  pnl_usd numeric(20, 4) not null,
  pnl_percent numeric(10, 4) not null,
  is_winner boolean not null,
  exit_reason character varying(50) null,
  order_id character varying(100) null,
  notes text null,
  asset_class public.asset_class_type null,
  strategy_id uuid null,
  exchange text null,
  user_id uuid null,
  constraint trades_pkey primary key (id),
  constraint trades_strategy_id_fkey foreign KEY (strategy_id) references strategies (id),
  constraint trades_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_trades_exchange on public.trades using btree (exchange) TABLESPACE pg_default;

create index IF not exists idx_trades_user_id on public.trades using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_trades_symbol on public.trades using btree (symbol) TABLESPACE pg_default;

create index IF not exists idx_trades_created_at on public.trades using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_trades_entry_time on public.trades using btree (entry_time desc) TABLESPACE pg_default;

create index IF not exists idx_trades_is_winner on public.trades using btree (is_winner) TABLESPACE pg_default;

create index IF not exists idx_trades_asset_class on public.trades using btree (asset_class) TABLESPACE pg_default;

create index IF not exists idx_trades_strategy_id on public.trades using btree (strategy_id) TABLESPACE pg_default;

create index IF not exists idx_trades_user_id_created_at on public.trades using btree (user_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_trades_user_id_asset_class on public.trades using btree (user_id, asset_class) TABLESPACE pg_default;

create index IF not exists idx_trades_user_id_exchange on public.trades using btree (user_id, exchange) TABLESPACE pg_default;