-- Updated Supabase Schema for Sparky-TradeFI Integration
-- Run this in Supabase SQL Editor to fix schema mismatches

-- =====================================================
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- =====================================================

-- Add asset_class column to trades table
ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS asset_class TEXT;

-- Add exchange column to trades table  
ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS exchange TEXT;

-- Add asset_class column to positions table
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS asset_class TEXT;

-- Add exchange column to positions table
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS exchange TEXT;

-- =====================================================
-- CREATE INDEXES FOR NEW COLUMNS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_trades_asset_class ON trades(asset_class);
CREATE INDEX IF NOT EXISTS idx_trades_exchange ON trades(exchange);
CREATE INDEX IF NOT EXISTS idx_positions_asset_class ON positions(asset_class);
CREATE INDEX IF NOT EXISTS idx_positions_exchange ON positions(exchange);

-- =====================================================
-- UPDATE EXISTING RECORDS WITH DEFAULT VALUES
-- =====================================================

-- Update existing trades to have default values
UPDATE trades 
SET asset_class = 'crypto', exchange = 'aster' 
WHERE asset_class IS NULL AND exchange IS NULL;

-- Update existing positions to have default values
UPDATE positions 
SET asset_class = 'crypto', exchange = 'aster' 
WHERE asset_class IS NULL AND exchange IS NULL;

-- =====================================================
-- ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN trades.asset_class IS 'Asset class: crypto, forex, options, stocks';
COMMENT ON COLUMN trades.exchange IS 'Exchange: aster, oanda, tradier';
COMMENT ON COLUMN positions.asset_class IS 'Asset class: crypto, forex, options, stocks';
COMMENT ON COLUMN positions.exchange IS 'Exchange: aster, oanda, tradier';

-- =====================================================
-- VERIFY SCHEMA
-- =====================================================

-- Check that all required columns exist
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name IN ('trades', 'positions')
  AND column_name IN ('asset_class', 'exchange')
ORDER BY table_name, column_name;

-- =====================================================
-- SUCCESS!
-- =====================================================
-- Schema updated successfully!
-- Next: Update Sparky bot code to include asset_class and exchange
-- =====================================================
