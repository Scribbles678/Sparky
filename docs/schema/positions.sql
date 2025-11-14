-- Table: public.positions

CREATE TABLE IF NOT EXISTS public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  symbol character varying(20) NOT NULL,
  side character varying(10) NOT NULL,
  entry_price numeric(20, 8) NOT NULL,
  entry_time timestamp with time zone NOT NULL,
  quantity numeric(20, 8) NOT NULL,
  position_size_usd numeric(20, 2) NOT NULL,
  stop_loss_price numeric(20, 8),
  take_profit_price numeric(20, 8),
  stop_loss_percent numeric(10, 4),
  take_profit_percent numeric(10, 4),
  entry_order_id character varying(100),
  stop_loss_order_id character varying(100),
  take_profit_order_id character varying(100),
  current_price numeric(20, 8),
  unrealized_pnl_usd numeric(20, 4),
  unrealized_pnl_percent numeric(10, 4),
  last_price_update timestamp with time zone,
  notes text,
  asset_class public.asset_class_type,
  strategy_id uuid REFERENCES strategies(id),
  exchange text,
  CONSTRAINT positions_symbol_key UNIQUE (symbol)
);

CREATE INDEX IF NOT EXISTS idx_positions_exchange
  ON public.positions (exchange);

CREATE INDEX IF NOT EXISTS idx_positions_symbol
  ON public.positions (symbol);

CREATE INDEX IF NOT EXISTS idx_positions_created_at
  ON public.positions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_positions_asset_class
  ON public.positions (asset_class);

CREATE INDEX IF NOT EXISTS idx_positions_strategy_id
  ON public.positions (strategy_id);

