-- =====================================================
-- Tradier Option Trades Table
-- =====================================================

CREATE TABLE IF NOT EXISTS tradier_option_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  status TEXT DEFAULT 'pending',
  strategy TEXT,

  underlying_symbol TEXT NOT NULL,
  option_symbol TEXT NOT NULL,
  option_type TEXT,
  strike_price NUMERIC(18,4),
  expiration_date DATE,
  contract_size INTEGER DEFAULT 100,
  quantity_contracts NUMERIC(18,4),

  entry_order_id TEXT,
  tp_order_id TEXT,
  sl_order_id TEXT,
  time_exit_order_id TEXT,

  entry_order JSONB,
  tp_leg JSONB,
  sl_leg JSONB,
  time_exit_order JSONB,

  entry_limit_price NUMERIC(18,8),
  tp_limit_price NUMERIC(18,8),
  sl_stop_price NUMERIC(18,8),
  sl_limit_price NUMERIC(18,8),

  cost_usd NUMERIC(18,4),
  pnl_usd NUMERIC(18,4),
  pnl_percent NUMERIC(18,4),

  config_snapshot JSONB DEFAULT '{}'::jsonb,
  extra_metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tradier_option_trades_status
  ON tradier_option_trades (status);

CREATE INDEX IF NOT EXISTS idx_tradier_option_trades_option_symbol
  ON tradier_option_trades (option_symbol);

ALTER TABLE tradier_option_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for anon" ON tradier_option_trades
  FOR SELECT TO anon USING (TRUE);

CREATE POLICY "Allow full access for service role" ON tradier_option_trades
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

