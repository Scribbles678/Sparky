-- =============================================================================
-- DATABASE ANALYSIS QUERIES (FIXED - NO DIVISION BY ZERO)
-- =============================================================================
-- Run these queries one by one to get the information needed for analysis

-- =============================================================================
-- 1. SHOW ALL TABLES AND VIEWS
-- =============================================================================
SELECT 'TABLES AND VIEWS' as section, tablename as name, 'table' as type 
FROM pg_tables 
WHERE schemaname = 'public'
UNION ALL
SELECT 'TABLES AND VIEWS' as section, viewname as name, 'view' as type
FROM pg_views 
WHERE schemaname = 'public'
ORDER BY name;

-- =============================================================================
-- 2. TRADES SUMMARY WITH ASSET CLASS BREAKDOWN
-- =============================================================================
SELECT 
    'TRADES SUMMARY' as section,
    COUNT(*) as total_trades,
    COUNT(CASE WHEN asset_class = 'crypto' THEN 1 END) as crypto_trades,
    COUNT(CASE WHEN asset_class = 'forex' THEN 1 END) as forex_trades,
    COUNT(CASE WHEN asset_class = 'options' THEN 1 END) as options_trades,
    COUNT(CASE WHEN asset_class IS NULL THEN 1 END) as null_asset_class,
    COUNT(CASE WHEN exchange = 'aster' THEN 1 END) as aster_trades,
    COUNT(CASE WHEN exchange = 'oanda' THEN 1 END) as oanda_trades,
    COUNT(CASE WHEN exchange = 'tradier' THEN 1 END) as tradier_trades,
    COUNT(CASE WHEN exchange IS NULL THEN 1 END) as null_exchange
FROM trades;

-- =============================================================================
-- 3. POSITIONS SUMMARY WITH ASSET CLASS BREAKDOWN
-- =============================================================================
SELECT 
    'POSITIONS SUMMARY' as section,
    COUNT(*) as total_positions,
    COUNT(CASE WHEN asset_class = 'crypto' THEN 1 END) as crypto_positions,
    COUNT(CASE WHEN asset_class = 'forex' THEN 1 END) as forex_positions,
    COUNT(CASE WHEN asset_class = 'options' THEN 1 END) as options_positions,
    COUNT(CASE WHEN asset_class IS NULL THEN 1 END) as null_asset_class,
    COUNT(CASE WHEN exchange = 'aster' THEN 1 END) as aster_positions,
    COUNT(CASE WHEN exchange = 'oanda' THEN 1 END) as oanda_positions,
    COUNT(CASE WHEN exchange = 'tradier' THEN 1 END) as tradier_positions,
    COUNT(CASE WHEN exchange IS NULL THEN 1 END) as null_exchange
FROM positions;

-- =============================================================================
-- 4. RECENT TRADES SAMPLE (LAST 10)
-- =============================================================================
SELECT 
    'RECENT TRADES' as section,
    symbol,
    side,
    asset_class,
    exchange,
    pnl_usd,
    pnl_percent,
    is_winner,
    exit_time
FROM trades 
ORDER BY exit_time DESC 
LIMIT 10;

-- =============================================================================
-- 5. CURRENT POSITIONS DETAILS
-- =============================================================================
SELECT 
    'CURRENT POSITIONS' as section,
    symbol,
    side,
    asset_class,
    exchange,
    entry_price,
    current_price,
    unrealized_pnl_usd,
    unrealized_pnl_percent
FROM positions 
ORDER BY created_at DESC;

-- =============================================================================
-- 6. STRATEGIES DETAILS
-- =============================================================================
SELECT 
    'STRATEGIES DETAILS' as section,
    name,
    status,
    asset_class,
    risk_level,
    total_trades,
    success_rate,
    avg_profit,
    CASE WHEN pine_script IS NOT NULL THEN 'YES' ELSE 'NO' END as has_pine_script
FROM strategies 
ORDER BY created_at DESC;

-- =============================================================================
-- 7. DATA QUALITY CHECKS
-- =============================================================================
-- Check for missing asset_class values
SELECT 'DATA QUALITY - MISSING ASSET_CLASS IN TRADES' as check_name, COUNT(*) as count
FROM trades WHERE asset_class IS NULL;

SELECT 'DATA QUALITY - MISSING ASSET_CLASS IN POSITIONS' as check_name, COUNT(*) as count
FROM positions WHERE asset_class IS NULL;

-- Check for missing exchange values
SELECT 'DATA QUALITY - MISSING EXCHANGE IN TRADES' as check_name, COUNT(*) as count
FROM trades WHERE exchange IS NULL;

SELECT 'DATA QUALITY - MISSING EXCHANGE IN POSITIONS' as check_name, COUNT(*) as count
FROM positions WHERE exchange IS NULL;

-- =============================================================================
-- 8. TODAY'S PERFORMANCE (using todays_trades view) - FIXED
-- =============================================================================
SELECT 
    'TODAYS PERFORMANCE' as section,
    COUNT(*) as todays_trades,
    COUNT(CASE WHEN is_winner = true THEN 1 END) as winning_trades,
    COUNT(CASE WHEN is_winner = false THEN 1 END) as losing_trades,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN is_winner = true THEN 1 END)::decimal / COUNT(*)) * 100, 2)
        ELSE 0 
    END as win_rate_percent,
    COALESCE(SUM(pnl_usd), 0) as total_pnl_usd,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND(AVG(pnl_usd), 2)
        ELSE 0 
    END as avg_pnl_usd
FROM todays_trades;

-- =============================================================================
-- 9. ASSET CLASS DISTRIBUTION - FIXED
-- =============================================================================
SELECT 
    'ASSET CLASS DISTRIBUTION' as section,
    asset_class,
    COUNT(*) as trade_count,
    COALESCE(SUM(pnl_usd), 0) as total_pnl,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND(AVG(pnl_usd), 2)
        ELSE 0 
    END as avg_pnl,
    COUNT(CASE WHEN is_winner = true THEN 1 END) as winning_trades,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN is_winner = true THEN 1 END)::decimal / COUNT(*)) * 100, 2)
        ELSE 0 
    END as win_rate
FROM trades 
GROUP BY asset_class 
ORDER BY trade_count DESC;

-- =============================================================================
-- 10. EXCHANGE DISTRIBUTION - FIXED
-- =============================================================================
SELECT 
    'EXCHANGE DISTRIBUTION' as section,
    exchange,
    COUNT(*) as trade_count,
    COALESCE(SUM(pnl_usd), 0) as total_pnl,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND(AVG(pnl_usd), 2)
        ELSE 0 
    END as avg_pnl,
    COUNT(CASE WHEN is_winner = true THEN 1 END) as winning_trades,
    CASE 
        WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN is_winner = true THEN 1 END)::decimal / COUNT(*)) * 100, 2)
        ELSE 0 
    END as win_rate
FROM trades 
GROUP BY exchange 
ORDER BY trade_count DESC;
