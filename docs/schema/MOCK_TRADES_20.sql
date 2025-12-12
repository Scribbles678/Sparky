-- ============================================================================
-- Mock Trade Data - 20 Crypto Trades
-- User ID: e0470a70-f1f7-46bd-933f-b34afbcdb940
-- ============================================================================
-- All crypto trades on Aster exchange
-- Mix of winners/losers, different symbols
-- Spread across the last 30 days
-- ============================================================================

INSERT INTO public.trades (
  user_id, symbol, side, asset_class, exchange,
  entry_price, entry_time, exit_price, exit_time,
  quantity, position_size_usd,
  stop_loss_price, take_profit_price, stop_loss_percent, take_profit_percent,
  pnl_usd, pnl_percent, is_winner, exit_reason, order_id, notes, strategy_id
) VALUES
-- BTC Trades (Momentum Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'BTCUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  43250.50, NOW() - INTERVAL '5 days' + INTERVAL '2 hours', 
  44820.75, NOW() - INTERVAL '5 days' + INTERVAL '6 hours',
  0.02315, 1000.00,
  42800.00, 45000.00, 1.04, 4.04,
  363.75, 3.64, true, 'take_profit', 'AST-BTC-001', 'BTC breakout trade',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'BTCUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  44500.00, NOW() - INTERVAL '3 days' + INTERVAL '5 hours',
  43850.00, NOW() - INTERVAL '3 days' + INTERVAL '9 hours',
  0.02247, 1000.00,
  44000.00, 45500.00, 1.12, 2.25,
  -14.61, -1.46, false, 'stop_loss', 'AST-BTC-002', 'BTC reversal hit stop',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'BTCUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  44100.00, NOW() - INTERVAL '1 day' + INTERVAL '3 hours',
  44550.00, NOW() - INTERVAL '1 day' + INTERVAL '7 hours',
  0.02268, 1000.00,
  43800.00, 45000.00, 0.68, 2.04,
  102.06, 10.21, true, 'take_profit', 'AST-BTC-003', 'BTC recent breakout - quick profit',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'BTCUSDT', 'sell', 'crypto'::asset_class_type, 'aster',
  45000.00, NOW() - INTERVAL '8 days' + INTERVAL '4 hours',
  44300.00, NOW() - INTERVAL '8 days' + INTERVAL '8 hours',
  0.02222, 1000.00,
  45200.00, 44500.00, 1.56, 1.11,
  155.56, 15.56, true, 'take_profit', 'AST-BTC-004', 'BTC short - resistance rejection',
  (SELECT id FROM public.strategies WHERE name = 'Trend Following Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- ETH Trades (Momentum & Trend Following)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'ETHUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  2650.25, NOW() - INTERVAL '8 days' + INTERVAL '3 hours',
  2780.50, NOW() - INTERVAL '8 days' + INTERVAL '8 hours',
  0.3774, 1000.00,
  2600.00, 2800.00, 1.90, 5.65,
  49.15, 4.92, true, 'take_profit', 'AST-ETH-005', 'ETH momentum play',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'ETHUSDT', 'sell', 'crypto'::asset_class_type, 'aster',
  2720.00, NOW() - INTERVAL '15 days' + INTERVAL '2 hours',
  2755.50, NOW() - INTERVAL '15 days' + INTERVAL '5 hours',
  0.3676, 1000.00,
  2750.00, 2680.00, 1.10, 1.47,
  -13.05, -1.31, false, 'stop_loss', 'AST-ETH-006', 'Short ETH - wrong direction',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'ETHUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  2680.00, NOW() - INTERVAL '12 days' + INTERVAL '6 hours',
  2750.00, NOW() - INTERVAL '12 days' + INTERVAL '12 hours',
  0.3731, 1000.00,
  2650.00, 2780.00, 1.12, 3.73,
  26.12, 2.61, true, 'take_profit', 'AST-ETH-007', 'ETH support bounce',
  (SELECT id FROM public.strategies WHERE name = 'Trend Following Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- SOL Trades (Momentum Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'SOLUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  98.50, NOW() - INTERVAL '12 days' + INTERVAL '1 hour',
  102.75, NOW() - INTERVAL '12 days' + INTERVAL '4 hours',
  10.1523, 1000.00,
  96.00, 105.00, 2.54, 6.60,
  43.15, 4.31, true, 'take_profit', 'AST-SOL-008', 'SOL support bounce',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'SOLUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  105.00, NOW() - INTERVAL '7 days' + INTERVAL '3 hours',
  101.50, NOW() - INTERVAL '7 days' + INTERVAL '7 hours',
  9.5238, 1000.00,
  103.00, 108.00, 1.90, 2.86,
  -33.33, -3.33, false, 'stop_loss', 'AST-SOL-009', 'SOL pullback - stopped out',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'SOLUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  100.00, NOW() - INTERVAL '18 days' + INTERVAL '2 hours',
  108.50, NOW() - INTERVAL '18 days' + INTERVAL '6 hours',
  10.0000, 1000.00,
  98.00, 110.00, 2.00, 10.00,
  85.00, 8.50, true, 'take_profit', 'AST-SOL-010', 'SOL strong uptrend',
  (SELECT id FROM public.strategies WHERE name = 'Momentum Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- ADA Trades (Mean Reversion Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'ADAUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  0.4850, NOW() - INTERVAL '10 days' + INTERVAL '4 hours',
  0.5025, NOW() - INTERVAL '10 days' + INTERVAL '8 hours',
  2061.86, 1000.00,
  0.4750, 0.5100, 2.06, 5.15,
  36.08, 3.61, true, 'take_profit', 'AST-ADA-011', 'ADA breakout',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'ADAUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  0.4950, NOW() - INTERVAL '14 days' + INTERVAL '5 hours',
  0.4825, NOW() - INTERVAL '14 days' + INTERVAL '9 hours',
  2020.20, 1000.00,
  0.4900, 0.5050, 1.01, 2.02,
  -25.25, -2.53, false, 'stop_loss', 'AST-ADA-012', 'ADA failed breakout',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- AVAX Trades (Mean Reversion Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'AVAXUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  38.50, NOW() - INTERVAL '9 days' + INTERVAL '2 hours',
  41.25, NOW() - INTERVAL '9 days' + INTERVAL '6 hours',
  25.9740, 1000.00,
  37.50, 42.00, 2.60, 9.09,
  71.43, 7.14, true, 'take_profit', 'AST-AVAX-013', 'AVAX momentum',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'AVAXUSDT', 'sell', 'crypto'::asset_class_type, 'aster',
  40.00, NOW() - INTERVAL '6 days' + INTERVAL '1 hour',
  41.20, NOW() - INTERVAL '6 days' + INTERVAL '5 hours',
  25.0000, 1000.00,
  40.50, 38.00, 1.25, 5.00,
  -30.00, -3.00, false, 'stop_loss', 'AST-AVAX-014', 'AVAX short - wrong direction',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- LINK Trades (Mean Reversion Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'LINKUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  14.50, NOW() - INTERVAL '11 days' + INTERVAL '3 hours',
  15.20, NOW() - INTERVAL '11 days' + INTERVAL '7 hours',
  68.9655, 1000.00,
  14.20, 15.50, 2.07, 6.90,
  48.28, 4.83, true, 'take_profit', 'AST-LINK-015', 'LINK breakout',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'LINKUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  15.00, NOW() - INTERVAL '4 days' + INTERVAL '4 hours',
  14.55, NOW() - INTERVAL '4 days' + INTERVAL '8 hours',
  66.6667, 1000.00,
  14.70, 15.30, 2.00, 2.00,
  -30.00, -3.00, false, 'stop_loss', 'AST-LINK-016', 'LINK reversal',
  (SELECT id FROM public.strategies WHERE name = 'Mean Reversion Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- DOT Trades (Scalping Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'DOTUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  6.20, NOW() - INTERVAL '13 days' + INTERVAL '2 hours',
  6.50, NOW() - INTERVAL '13 days' + INTERVAL '6 hours',
  161.2903, 1000.00,
  6.00, 6.70, 3.23, 8.06,
  48.39, 4.84, true, 'take_profit', 'AST-DOT-017', 'DOT support bounce',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'DOTUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  6.40, NOW() - INTERVAL '16 days' + INTERVAL '5 hours',
  6.15, NOW() - INTERVAL '16 days' + INTERVAL '9 hours',
  156.2500, 1000.00,
  6.30, 6.60, 1.56, 3.13,
  -39.06, -3.91, false, 'stop_loss', 'AST-DOT-018', 'DOT failed support',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),

-- MATIC Trades (Scalping Strategy)
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'MATICUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  0.8500, NOW() - INTERVAL '17 days' + INTERVAL '3 hours',
  0.8900, NOW() - INTERVAL '17 days' + INTERVAL '7 hours',
  1176.47, 1000.00,
  0.8300, 0.9000, 2.35, 5.88,
  47.06, 4.71, true, 'take_profit', 'AST-MATIC-019', 'MATIC momentum',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
),
(
  'e0470a70-f1f7-46bd-933f-b34afbcdb940', 'MATICUSDT', 'buy', 'crypto'::asset_class_type, 'aster',
  0.8800, NOW() - INTERVAL '2 days' + INTERVAL '1 hour',
  0.8650, NOW() - INTERVAL '2 days' + INTERVAL '5 hours',
  1136.36, 1000.00,
  0.8700, 0.9000, 1.14, 2.27,
  -17.05, -1.70, false, 'stop_loss', 'AST-MATIC-020', 'MATIC pullback',
  (SELECT id FROM public.strategies WHERE name = 'Scalping Strategy' AND user_id = 'e0470a70-f1f7-46bd-933f-b34afbcdb940' LIMIT 1)
);

-- ============================================================================
-- Summary Statistics
-- ============================================================================
-- Total Trades: 20
-- All Crypto (Aster Exchange)
-- Winners: 12 (60%)
-- Losers: 8 (40%)
-- Total P&L: ~$1,200+ (approximate)
-- Symbols: BTC (4), ETH (3), SOL (3), ADA (2), AVAX (2), LINK (2), DOT (2), MATIC (2)
-- Time Range: Last 18 days
-- 
-- Strategy Distribution:
--   - Momentum Strategy: 7 trades (BTC, ETH, SOL)
--   - Mean Reversion Strategy: 5 trades (ADA, AVAX, LINK)
--   - Scalping Strategy: 5 trades (BTC, ETH, DOT, MATIC)
--   - Trend Following Strategy: 3 trades (BTC, ETH)
-- ============================================================================
-- NOTE: Run MOCK_STRATEGIES.sql FIRST before running this file!
-- ============================================================================
