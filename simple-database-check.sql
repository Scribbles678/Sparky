-- Simple Database Check - Run this instead
-- This will show key information in a more readable format

-- 1. Show all your tables
SELECT 'TABLES' as info, tablename as name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- 2. Show trades summary
SELECT 'TRADES SUMMARY' as info, 
       COUNT(*) as total_trades,
       COUNT(CASE WHEN asset_class = 'crypto' THEN 1 END) as crypto_trades,
       COUNT(CASE WHEN asset_class = 'forex' THEN 1 END) as forex_trades,
       COUNT(CASE WHEN asset_class = 'options' THEN 1 END) as options_trades,
       COUNT(CASE WHEN asset_class IS NULL THEN 1 END) as null_asset_class
FROM trades;

-- 3. Show positions summary  
SELECT 'POSITIONS SUMMARY' as info,
       COUNT(*) as total_positions,
       COUNT(CASE WHEN asset_class = 'crypto' THEN 1 END) as crypto_positions,
       COUNT(CASE WHEN asset_class = 'forex' THEN 1 END) as forex_positions,
       COUNT(CASE WHEN asset_class = 'options' THEN 1 END) as options_positions,
       COUNT(CASE WHEN asset_class IS NULL THEN 1 END) as null_asset_class
FROM positions;

-- 4. Show strategies summary
SELECT 'STRATEGIES SUMMARY' as info,
       COUNT(*) as total_strategies,
       COUNT(CASE WHEN status = 'active' THEN 1 END) as active_strategies,
       COUNT(CASE WHEN pine_script IS NOT NULL THEN 1 END) as with_pine_script
FROM strategies;

-- 5. Show recent trades
SELECT 'RECENT TRADES' as info, symbol, side, asset_class, exchange, pnl_usd, exit_time 
FROM trades 
ORDER BY exit_time DESC 
LIMIT 5;

-- 6. Show current positions
SELECT 'CURRENT POSITIONS' as info, symbol, side, asset_class, exchange, entry_price, current_price
FROM positions 
ORDER BY created_at DESC;
