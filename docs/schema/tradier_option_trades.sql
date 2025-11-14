-- Table: public.tradier_option_trades

CREATE TABLE IF NOT EXISTS public.tradier_option_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'pending',
  strategy text,
  underlying_symbol text NOT NULL,
  option_symbol text NOT NULL,
  option_type text,
  strike_price numeric(18, 4),
  expiration_date date,
  contract_size integer DEFAULT 100,
  quantity_contracts numeric(18, 4),
  entry_order_id text,
  tp_order_id text,
  sl_order_id text,
  time_exit_order_id text,
  entry_order jsonb,
  tp_leg jsonb,
  sl_leg jsonb,
  time_exit_order jsonb,
  entry_limit_price numeric(18, 8),
  tp_limit_price numeric(18, 8),
  sl_stop_price numeric(18, 8),
  sl_limit_price numeric(18, 8),
  cost_usd numeric(18, 4),
  pnl_usd numeric(18, 4),
  pnl_percent numeric(18, 4),
  config_snapshot jsonb DEFAULT '{}'::jsonb,
  extra_metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tradier_option_trades_status
  ON public.tradier_option_trades (status);

CREATE INDEX IF NOT EXISTS idx_tradier_option_trades_option_symbol
  ON public.tradier_option_trades (option_symbol);

