create table public.trade_settings_exchange (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  exchange text not null,
  trading_hours_preset text null default '24/5'::text,
  trading_window jsonb null default '["00:00", "23:59"]'::jsonb,
  max_trades_per_week integer null default 0,
  allow_weekends boolean null default false,
  strike_tolerance_percent numeric(10, 4) null default 1,
  entry_limit_offset_percent numeric(10, 4) null default 1,
  max_signal_age_sec integer null default 10,
  auto_close_outside_window boolean null default true,
  max_open_positions integer null default 3,
  user_id uuid null,
  max_loss_per_week_usd numeric(18, 2) null default 0,
  constraint trade_settings_exchange_pkey primary key (id),
  constraint trade_settings_exchange_user_exchange_key unique (user_id, exchange),
  constraint trade_settings_exchange_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_trade_settings_exchange_exchange on public.trade_settings_exchange using btree (exchange) TABLESPACE pg_default;

create index IF not exists idx_trade_settings_exchange_user_id on public.trade_settings_exchange using btree (user_id) TABLESPACE pg_default;