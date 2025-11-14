-- Sparky Trading Bot Database Schema
-- Run this in Supabase SQL Editor

-- =====================================================
-- TRADES TABLE
-- Stores all completed trades (entry + exit)
-- =====================================================
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Trade Details
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL, -- 'BUY' or 'SELL'
  
  -- Entry
  entry_price DECIMAL(20, 8) NOT NULL,
  entry_time TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Exit
  exit_price DECIMAL(20, 8) NOT NULL,
  exit_time TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Position Details
  quantity DECIMAL(20, 8) NOT NULL,
  position_size_usd DECIMAL(20, 2) NOT NULL, -- e.g., 100.00
  
  -- Risk Management
  stop_loss_price DECIMAL(20, 8),
  take_profit_price DECIMAL(20, 8),
  stop_loss_percent DECIMAL(10, 4),
  take_profit_percent DECIMAL(10, 4),
  
  -- Results
  pnl_usd DECIMAL(20, 4) NOT NULL, -- Profit/Loss in USD
  pnl_percent DECIMAL(10, 4) NOT NULL, -- Profit/Loss percentage
  is_winner BOOLEAN NOT NULL, -- true if profit, false if loss
  
  -- Exit Reason
  exit_reason VARCHAR(50), -- 'STOP_LOSS', 'TAKE_PROFIT', 'MANUAL', 'SIGNAL'
  
  -- Metadata
  order_id VARCHAR(100),
  notes TEXT
);

-- =====================================================
-- POSITIONS TABLE
-- Stores currently open positions
-- =====================================================
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Position Details
  symbol VARCHAR(20) NOT NULL UNIQUE, -- One position per symbol
  side VARCHAR(10) NOT NULL, -- 'BUY' or 'SELL'
  
  -- Entry
  entry_price DECIMAL(20, 8) NOT NULL,
  entry_time TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Position Details
  quantity DECIMAL(20, 8) NOT NULL,
  position_size_usd DECIMAL(20, 2) NOT NULL,
  
  -- Risk Management
  stop_loss_price DECIMAL(20, 8),
  take_profit_price DECIMAL(20, 8),
  stop_loss_percent DECIMAL(10, 4),
  take_profit_percent DECIMAL(10, 4),
  
  -- Orders
  entry_order_id VARCHAR(100),
  stop_loss_order_id VARCHAR(100),
  take_profit_order_id VARCHAR(100),
  
  -- Current Status
  current_price DECIMAL(20, 8),
  unrealized_pnl_usd DECIMAL(20, 4),
  unrealized_pnl_percent DECIMAL(10, 4),
  last_price_update TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  notes TEXT
);

-- =====================================================
-- INDEXES for Performance
-- =====================================================

-- Trades table indexes
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_trades_is_winner ON trades(is_winner);

-- Positions table indexes
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_created_at ON positions(created_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS but allow all operations for now
-- (You can restrict this later if needed)
-- =====================================================

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for service_role
CREATE POLICY "Allow all for service_role" ON trades
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all for service_role" ON positions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Allow read access for anon users (for dashboard)
CREATE POLICY "Allow read for anon" ON trades
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow read for anon" ON positions
  FOR SELECT
  TO anon
  USING (true);

-- =====================================================
-- HELPER VIEWS (Optional but useful)
-- =====================================================

-- View: Today's trades
CREATE OR REPLACE VIEW todays_trades AS
SELECT *
FROM trades
WHERE DATE(exit_time) = CURRENT_DATE
ORDER BY exit_time DESC;

-- View: Open positions summary
CREATE OR REPLACE VIEW positions_summary AS
SELECT
  COUNT(*) as open_positions,
  SUM(position_size_usd) as total_position_size,
  SUM(unrealized_pnl_usd) as total_unrealized_pnl,
  AVG(unrealized_pnl_percent) as avg_unrealized_pnl_percent
FROM positions;

-- View: Trading statistics
CREATE OR REPLACE VIEW trade_stats AS
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as winning_trades,
  SUM(CASE WHEN NOT is_winner THEN 1 ELSE 0 END) as losing_trades,
  ROUND(
    (SUM(CASE WHEN is_winner THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)) * 100,
    2
  ) as win_rate_percent,
  SUM(pnl_usd) as total_pnl_usd,
  AVG(pnl_usd) as avg_pnl_per_trade,
  MAX(pnl_usd) as largest_win,
  MIN(pnl_usd) as largest_loss,
  AVG(CASE WHEN is_winner THEN pnl_usd END) as avg_win,
  AVG(CASE WHEN NOT is_winner THEN pnl_usd END) as avg_loss
FROM trades;

-- =====================================================
-- SUCCESS!
-- =====================================================
-- Your tables are ready! 
-- Next steps:
-- 1. Run this SQL in Supabase SQL Editor
-- 2. Install Supabase client in Sparky bot
-- 3. Start logging trades!
-- =====================================================

