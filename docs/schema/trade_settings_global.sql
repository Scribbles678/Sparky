-- Table: public.trade_settings_global

CREATE TABLE IF NOT EXISTS public.trade_settings_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
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
  extra_settings jsonb DEFAULT '{}'::jsonb
);

