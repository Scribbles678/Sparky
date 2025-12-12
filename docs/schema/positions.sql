create table public.positions (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  symbol character varying(20) not null,
  side character varying(10) not null,
  entry_price numeric(20, 8) not null,
  entry_time timestamp with time zone not null,
  quantity numeric(20, 8) not null,
  position_size_usd numeric(20, 2) not null,
  stop_loss_price numeric(20, 8) null,
  take_profit_price numeric(20, 8) null,
  stop_loss_percent numeric(10, 4) null,
  take_profit_percent numeric(10, 4) null,
  entry_order_id character varying(100) null,
  stop_loss_order_id character varying(100) null,
  take_profit_order_id character varying(100) null,
  current_price numeric(20, 8) null,
  unrealized_pnl_usd numeric(20, 4) null,
  unrealized_pnl_percent numeric(10, 4) null,
  last_price_update timestamp with time zone null,
  notes text null,
  asset_class public.asset_class_type null,
  strategy_id uuid null,
  exchange text null,
  user_id uuid null,
  constraint positions_pkey primary key (id),
  constraint positions_user_symbol_unique unique (user_id, symbol),
  constraint positions_strategy_id_fkey foreign KEY (strategy_id) references strategies (id),
  constraint positions_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_positions_exchange on public.positions using btree (exchange) TABLESPACE pg_default;

create index IF not exists idx_positions_user_id on public.positions using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_positions_symbol on public.positions using btree (symbol) TABLESPACE pg_default;

create index IF not exists idx_positions_created_at on public.positions using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_positions_asset_class on public.positions using btree (asset_class) TABLESPACE pg_default;

create index IF not exists idx_positions_strategy_id on public.positions using btree (strategy_id) TABLESPACE pg_default;

create index IF not exists idx_positions_user_id_exchange on public.positions using btree (user_id, exchange) TABLESPACE pg_default;

create index IF not exists idx_positions_user_id_asset_class on public.positions using btree (user_id, asset_class) TABLESPACE pg_default;

create index IF not exists idx_positions_user_id_symbol on public.positions using btree (user_id, symbol) TABLESPACE pg_default;