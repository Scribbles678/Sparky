-- =====================================================
-- Trade Settings Tables
-- =====================================================

CREATE TABLE IF NOT EXISTS trade_settings_global (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Global defaults
  enabled BOOLEAN DEFAULT TRUE,
  trading_hours_preset TEXT DEFAULT '24/5',
  trading_window JSONB DEFAULT '["00:00","23:59"]',
  max_trades_per_day INTEGER DEFAULT 0, -- 0 = unlimited
  max_position_size_usd NUMERIC(18,2) DEFAULT 0, -- 0 = unlimited
  take_profit_percent NUMERIC(10,4) DEFAULT 0,
  stop_loss_percent NUMERIC(10,4) DEFAULT 0,
  allow_weekends BOOLEAN DEFAULT FALSE,
  news_filter BOOLEAN DEFAULT FALSE,
  notes TEXT,

  extra_settings JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trade_settings_exchange (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  exchange TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,

  -- Generic trading controls surfaced in TradeFI
  trading_hours_preset TEXT DEFAULT '24/5',
  trading_window JSONB DEFAULT '["00:00","23:59"]',
  max_trades_per_day INTEGER DEFAULT 0,
  max_position_size_usd NUMERIC(18,2) DEFAULT 0,
  take_profit_percent NUMERIC(10,4) DEFAULT 0,
  stop_loss_percent NUMERIC(10,4) DEFAULT 0,
  allow_weekends BOOLEAN DEFAULT FALSE,
  news_filter BOOLEAN DEFAULT FALSE,
  notes TEXT,

  -- Options-specific controls (used by Tradier options executor)
  position_size_percent NUMERIC(10,4) DEFAULT 0,
  strike_tolerance_percent NUMERIC(10,4) DEFAULT 1,
  entry_limit_offset_percent NUMERIC(10,4) DEFAULT 1,
  tp_percent NUMERIC(10,4) DEFAULT 5,
  sl_percent NUMERIC(10,4) DEFAULT 8,
  max_signal_age_sec INTEGER DEFAULT 10,
  auto_close_outside_window BOOLEAN DEFAULT TRUE,
  max_open_positions INTEGER DEFAULT 3,

  extra_settings JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_trade_settings_exchange_exchange
  ON trade_settings_exchange (exchange);

-- Basic RLS policies (optional – adjust as needed)
ALTER TABLE trade_settings_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_settings_exchange ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for anon" ON trade_settings_global
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "Allow read for anon" ON trade_settings_exchange
  FOR SELECT TO anon USING (TRUE);

CREATE POLICY "Allow full access for service role" ON trade_settings_global
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Allow full access for service role" ON trade_settings_exchange
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);


