-- Table: public.trade_settings_exchange

CREATE TABLE IF NOT EXISTS public.trade_settings_exchange (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  exchange text NOT NULL,
  enabled boolean DEFAULT true,
  trading_hours_preset text DEFAULT '24/5',
  trading_window jsonb DEFAULT '["00:00", "23:59"]'::jsonb,
  max_trades_per_day integer DEFAULT 0,
  max_position_size_usd numeric(18, 2) DEFAULT 0,
  take_profit_percent numeric(10, 4) DEFAULT 0,
  stop_loss_percent numeric(10, 4) DEFAULT 0,
  allow_weekends boolean DEFAULT false,
  news_filter boolean DEFAULT false,
  notes text,
  position_size_percent numeric(10, 4) DEFAULT 0,
  strike_tolerance_percent numeric(10, 4) DEFAULT 1,
  entry_limit_offset_percent numeric(10, 4) DEFAULT 1,
  tp_percent numeric(10, 4) DEFAULT 5,
  sl_percent numeric(10, 4) DEFAULT 8,
  max_signal_age_sec integer DEFAULT 10,
  auto_close_outside_window boolean DEFAULT true,
  max_open_positions integer DEFAULT 3,
  extra_settings jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT trade_settings_exchange_exchange_key UNIQUE (exchange)
);

CREATE INDEX IF NOT EXISTS idx_trade_settings_exchange_exchange
  ON public.trade_settings_exchange (exchange);

