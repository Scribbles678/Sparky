-- Table: public.trades

CREATE TABLE IF NOT EXISTS public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  symbol character varying(20) NOT NULL,
  side character varying(10) NOT NULL,
  entry_price numeric(20, 8) NOT NULL,
  entry_time timestamp with time zone NOT NULL,
  exit_price numeric(20, 8) NOT NULL,
  exit_time timestamp with time zone NOT NULL,
  quantity numeric(20, 8) NOT NULL,
  position_size_usd numeric(20, 2) NOT NULL,
  stop_loss_price numeric(20, 8),
  take_profit_price numeric(20, 8),
  stop_loss_percent numeric(10, 4),
  take_profit_percent numeric(10, 4),
  pnl_usd numeric(20, 4) NOT NULL,
  pnl_percent numeric(10, 4) NOT NULL,
  is_winner boolean NOT NULL,
  exit_reason character varying(50),
  order_id character varying(100),
  notes text,
  asset_class public.asset_class_type,
  strategy_id uuid REFERENCES strategies(id),
  exchange text
);

CREATE INDEX IF NOT EXISTS idx_trades_exchange
  ON public.trades (exchange);

CREATE INDEX IF NOT EXISTS idx_trades_symbol
  ON public.trades (symbol);

CREATE INDEX IF NOT EXISTS idx_trades_created_at
  ON public.trades (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_entry_time
  ON public.trades (entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_trades_is_winner
  ON public.trades (is_winner);

CREATE INDEX IF NOT EXISTS idx_trades_asset_class
  ON public.trades (asset_class);

CREATE INDEX IF NOT EXISTS idx_trades_strategy_id
  ON public.trades (strategy_id);

