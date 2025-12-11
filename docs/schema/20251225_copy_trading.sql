-- Copy Trading Schema Migration
-- Date: 2025-12-25
-- Purpose: Enable copy trading functionality for AI strategies

BEGIN;

-- ============================================================================
-- Copy Relationships Table
-- ============================================================================
-- Tracks which users are copying which AI strategies
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.copy_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  leader_strategy_id UUID REFERENCES public.ai_strategies(id) ON DELETE CASCADE NOT NULL,
  
  -- Allocation settings
  allocation_percent NUMERIC(6,2) NOT NULL DEFAULT 100.00 
    CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  
  -- Risk controls
  max_drawdown_stop NUMERIC(5,2) DEFAULT 30.00 
    CHECK (max_drawdown_stop >= 0 AND max_drawdown_stop <= 100),
  current_drawdown_percent NUMERIC(5,2) DEFAULT 0.00,
  
  -- High-Water Mark (HWM) for compliance
  -- Tracks highest equity peak - fees only charged on profits above this
  hwm_equity NUMERIC(14,2) DEFAULT 0.00,
  
  -- Status
  status TEXT DEFAULT 'active' 
    CHECK (status IN ('active', 'paused', 'stopped')),
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  
  -- Prevent duplicate relationships
  UNIQUE(follower_user_id, leader_strategy_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_copy_relationships_follower 
  ON public.copy_relationships(follower_user_id);
CREATE INDEX IF NOT EXISTS idx_copy_relationships_leader 
  ON public.copy_relationships(leader_strategy_id);
CREATE INDEX IF NOT EXISTS idx_copy_relationships_status 
  ON public.copy_relationships(status) 
  WHERE status = 'active';

-- ============================================================================
-- Copied Trades Table
-- ============================================================================
-- Tracks all trades executed for copy relationships
-- Used for billing, analytics, and transparency
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.copied_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_relationship_id UUID REFERENCES public.copy_relationships(id) ON DELETE CASCADE NOT NULL,
  
  -- Trade references
  original_trade_id UUID, -- Points to trades table (leader's trade)
  follower_trade_id UUID, -- Points to trades table (follower's trade)
  
  -- User references
  follower_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  leader_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  leader_strategy_id UUID REFERENCES public.ai_strategies(id) ON DELETE CASCADE NOT NULL,
  
  -- Trade details
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  leader_size_usd NUMERIC(14,2) NOT NULL,
  follower_size_usd NUMERIC(14,2) NOT NULL,
  
  -- P&L tracking (for billing)
  pnl_usd NUMERIC(14,2) DEFAULT 0, -- Follower's P&L from this trade
  pnl_percent NUMERIC(8,4) DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  
  -- Fee tracking
  override_fee_charged NUMERIC(14,2) DEFAULT 0,
  platform_fee_usd NUMERIC(14,2) DEFAULT 0, -- 40% of override fee
  leader_fee_usd NUMERIC(14,2) DEFAULT 0, -- 60% of override fee
  fee_paid_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  entry_time TIMESTAMPTZ,
  exit_time TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_copied_trades_relationship 
  ON public.copied_trades(copy_relationship_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_follower 
  ON public.copied_trades(follower_user_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_leader 
  ON public.copied_trades(leader_strategy_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_fee_paid 
  ON public.copied_trades(fee_paid_at) 
  WHERE fee_paid_at IS NULL AND pnl_usd > 0;

-- ============================================================================
-- Add Columns to ai_strategies Table
-- ============================================================================

ALTER TABLE public.ai_strategies 
ADD COLUMN IF NOT EXISTS is_public_leader BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS copy_override_percent NUMERIC(4,2) DEFAULT 15.00 
  CHECK (copy_override_percent >= 0 AND copy_override_percent <= 30),
ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS copiers_count INTEGER DEFAULT 0; -- Cached count for performance

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_ai_strategies_public_leaders 
  ON public.ai_strategies(is_public_leader, status) 
  WHERE is_public_leader = TRUE AND status = 'running';

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE public.copy_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copied_trades ENABLE ROW LEVEL SECURITY;

-- Copy relationships: Users can only see their own
CREATE POLICY "Users can view own copy relationships" 
  ON public.copy_relationships
  FOR SELECT
  USING (auth.uid() = follower_user_id);

CREATE POLICY "Users can create own copy relationships" 
  ON public.copy_relationships
  FOR INSERT
  WITH CHECK (auth.uid() = follower_user_id);

CREATE POLICY "Users can update own copy relationships" 
  ON public.copy_relationships
  FOR UPDATE
  USING (auth.uid() = follower_user_id);

CREATE POLICY "Users can delete own copy relationships" 
  ON public.copy_relationships
  FOR DELETE
  USING (auth.uid() = follower_user_id);

-- Copied trades: Users can only see their own
CREATE POLICY "Users can view own copied trades" 
  ON public.copied_trades
  FOR SELECT
  USING (auth.uid() = follower_user_id);

-- Leaders can view trades from their strategies (for earnings dashboard)
CREATE POLICY "Leaders can view trades from their strategies" 
  ON public.copied_trades
  FOR SELECT
  USING (auth.uid() = leader_user_id);

-- Service role can insert/update (for Sparky bot)
-- Note: Service role bypasses RLS, so no policy needed for inserts

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to update copiers_count cache
CREATE OR REPLACE FUNCTION update_copiers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ai_strategies
    SET copiers_count = (
      SELECT COUNT(*) 
      FROM public.copy_relationships 
      WHERE leader_strategy_id = NEW.leader_strategy_id 
      AND status = 'active'
    )
    WHERE id = NEW.leader_strategy_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Update both old and new strategy counts if strategy changed
    IF OLD.leader_strategy_id != NEW.leader_strategy_id OR OLD.status != NEW.status THEN
      UPDATE public.ai_strategies
      SET copiers_count = (
        SELECT COUNT(*) 
        FROM public.copy_relationships 
        WHERE leader_strategy_id = OLD.leader_strategy_id 
        AND status = 'active'
      )
      WHERE id = OLD.leader_strategy_id;
      
      UPDATE public.ai_strategies
      SET copiers_count = (
        SELECT COUNT(*) 
        FROM public.copy_relationships 
        WHERE leader_strategy_id = NEW.leader_strategy_id 
        AND status = 'active'
      )
      WHERE id = NEW.leader_strategy_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.ai_strategies
    SET copiers_count = (
      SELECT COUNT(*) 
      FROM public.copy_relationships 
      WHERE leader_strategy_id = OLD.leader_strategy_id 
      AND status = 'active'
    )
    WHERE id = OLD.leader_strategy_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update copiers_count
CREATE TRIGGER update_copiers_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.copy_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_copiers_count();

-- Function to get top strategies for leaderboard
CREATE OR REPLACE FUNCTION get_top_strategies_30d(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  name TEXT,
  user_id UUID,
  pnl_30d NUMERIC,
  win_rate NUMERIC,
  max_dd NUMERIC,
  copiers_count INTEGER,
  copy_override_percent NUMERIC,
  verified_badge BOOLEAN,
  risk_profile TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.name,
    s.user_id,
    COALESCE(
      (SELECT SUM(pnl_usd) 
       FROM public.trades 
       WHERE strategy_id = s.id 
       AND exit_time >= NOW() - INTERVAL '30 days'), 
      0
    )::NUMERIC AS pnl_30d,
    COALESCE(
      (SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN 
            (COUNT(*) FILTER (WHERE is_winner = TRUE)::NUMERIC / COUNT(*)::NUMERIC * 100)
          ELSE 0
        END
       FROM public.trades 
       WHERE strategy_id = s.id 
       AND exit_time >= NOW() - INTERVAL '30 days'),
      0
    )::NUMERIC AS win_rate,
    COALESCE(s.max_drawdown_percent, 20.00) AS max_dd,
    s.copiers_count,
    s.copy_override_percent,
    s.verified_badge,
    s.risk_profile
  FROM public.ai_strategies s
  WHERE s.is_public_leader = TRUE
    AND s.status = 'running'
  ORDER BY pnl_30d DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 
-- After running this migration:
-- 1. Verify tables created: copy_relationships, copied_trades
-- 2. Verify columns added to ai_strategies
-- 3. Verify RLS policies are active
-- 4. Test helper functions
--
-- To make a strategy public:
-- UPDATE ai_strategies SET is_public_leader = TRUE WHERE id = 'strategy-id';
--
-- To set override fee:
-- UPDATE ai_strategies SET copy_override_percent = 20.00 WHERE id = 'strategy-id';
--

