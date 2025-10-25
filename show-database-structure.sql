-- =============================================================================
-- SUPABASE DATABASE STRUCTURE ANALYSIS
-- =============================================================================
-- Run this script in your Supabase SQL Editor to show complete database structure
-- This will help analyze your current setup and identify any issues

-- =============================================================================
-- 1. SHOW ALL TABLES AND THEIR BASIC INFO
-- =============================================================================
SELECT 
    schemaname,
    tablename,
    tableowner,
    hasindexes,
    hasrules,
    hastriggers,
    rowsecurity
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- =============================================================================
-- 2. SHOW TABLE SCHEMAS (COLUMNS, TYPES, CONSTRAINTS)
-- =============================================================================
SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;

-- =============================================================================
-- 3. SHOW ENUMS AND CUSTOM TYPES
-- =============================================================================
SELECT 
    t.typname as type_name,
    e.enumlabel as enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname LIKE '%_type'
ORDER BY t.typname, e.enumsortorder;

-- =============================================================================
-- 4. SHOW INDEXES
-- =============================================================================
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- =============================================================================
-- 5. SHOW FOREIGN KEY RELATIONSHIPS
-- =============================================================================
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- =============================================================================
-- 6. SHOW ROW LEVEL SECURITY POLICIES
-- =============================================================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- =============================================================================
-- 7. SHOW TRADES TABLE DATA SAMPLE
-- =============================================================================
SELECT 
    'TRADES TABLE SAMPLE' as section,
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

-- Show recent trades
SELECT 
    'RECENT TRADES' as section,
    symbol,
    side,
    asset_class,
    exchange,
    pnl_usd,
    pnl_percent,
    exit_time
FROM trades 
ORDER BY exit_time DESC 
LIMIT 10;

-- =============================================================================
-- 8. SHOW POSITIONS TABLE DATA SAMPLE
-- =============================================================================
SELECT 
    'POSITIONS TABLE SAMPLE' as section,
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

-- Show current positions
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
-- 9. SHOW STRATEGIES TABLE DATA SAMPLE
-- =============================================================================
SELECT 
    'STRATEGIES TABLE SAMPLE' as section,
    COUNT(*) as total_strategies,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_strategies,
    COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_strategies,
    COUNT(CASE WHEN status = 'testing' THEN 1 END) as testing_strategies,
    COUNT(CASE WHEN asset_class = 'crypto' THEN 1 END) as crypto_strategies,
    COUNT(CASE WHEN asset_class = 'forex' THEN 1 END) as forex_strategies,
    COUNT(CASE WHEN asset_class = 'options' THEN 1 END) as options_strategies,
    COUNT(CASE WHEN pine_script IS NOT NULL THEN 1 END) as strategies_with_pine_script
FROM strategies;

-- Show all strategies
SELECT 
    'ALL STRATEGIES' as section,
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
-- 10. SHOW VIEWS AND FUNCTIONS
-- =============================================================================
SELECT 
    'VIEWS' as section,
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_type = 'VIEW'
ORDER BY table_name;

-- Show custom functions
SELECT 
    'FUNCTIONS' as section,
    routine_name,
    routine_type,
    data_type as return_type
FROM information_schema.routines 
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- =============================================================================
-- 11. DATA QUALITY CHECKS
-- =============================================================================
-- Check for missing asset_class values
SELECT 
    'MISSING ASSET_CLASS IN TRADES' as check_name,
    COUNT(*) as count
FROM trades 
WHERE asset_class IS NULL;

SELECT 
    'MISSING ASSET_CLASS IN POSITIONS' as check_name,
    COUNT(*) as count
FROM positions 
WHERE asset_class IS NULL;

-- Check for missing exchange values
SELECT 
    'MISSING EXCHANGE IN TRADES' as check_name,
    COUNT(*) as count
FROM trades 
WHERE exchange IS NULL;

SELECT 
    'MISSING EXCHANGE IN POSITIONS' as check_name,
    COUNT(*) as count
FROM positions 
WHERE exchange IS NULL;

-- Check for invalid asset_class values
SELECT 
    'INVALID ASSET_CLASS IN TRADES' as check_name,
    asset_class,
    COUNT(*) as count
FROM trades 
WHERE asset_class NOT IN ('crypto', 'forex', 'options') 
    AND asset_class IS NOT NULL
GROUP BY asset_class;

-- Check for invalid exchange values
SELECT 
    'INVALID EXCHANGE IN TRADES' as check_name,
    exchange,
    COUNT(*) as count
FROM trades 
WHERE exchange NOT IN ('aster', 'oanda', 'tradier') 
    AND exchange IS NOT NULL
GROUP BY exchange;

-- =============================================================================
-- 12. PERFORMANCE STATISTICS
-- =============================================================================
-- Show table sizes
SELECT 
    'TABLE SIZES' as section,
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Show row counts
SELECT 
    'ROW COUNTS' as section,
    'trades' as table_name,
    COUNT(*) as row_count
FROM trades
UNION ALL
SELECT 
    'ROW COUNTS' as section,
    'positions' as table_name,
    COUNT(*) as row_count
FROM positions
UNION ALL
SELECT 
    'ROW COUNTS' as section,
    'strategies' as table_name,
    COUNT(*) as row_count
FROM strategies;

-- =============================================================================
-- END OF ANALYSIS
-- =============================================================================
SELECT 'DATABASE ANALYSIS COMPLETE' as status;
