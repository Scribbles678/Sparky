-- =====================================================
-- Phase 1: Multi-User Support - Database Schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- USERS TABLE
-- Stores user accounts with authentication
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL, -- bcrypt hashed
  webhook_secret VARCHAR(255) UNIQUE NOT NULL, -- Auto-generated per user
  subscription_tier VARCHAR(50) DEFAULT 'free', -- 'free', 'basic', 'pro'
  rate_limit_per_min INTEGER DEFAULT 30, -- Per-user rate limit
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  
  -- Metadata
  name VARCHAR(255),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_webhook_secret ON users(webhook_secret);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- =====================================================
-- USER SESSIONS TABLE
-- Stores active login sessions
-- =====================================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL, -- JWT or session token
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);

-- =====================================================
-- UPDATE EXISTING TABLES
-- Add user_id to trades, positions, strategies
-- =====================================================

-- Add user_id to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);

-- Add user_id to positions table
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);

-- Remove old unique constraint on symbol, add user+symbol unique
DROP INDEX IF EXISTS idx_positions_symbol;
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_user_symbol ON positions(user_id, symbol);

-- Add user_id to strategies table (if it exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'strategies') THEN
    ALTER TABLE strategies ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
  END IF;
END $$;

-- Add user_id to tradier_option_trades (if it exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tradier_option_trades') THEN
    ALTER TABLE tradier_option_trades ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_tradier_option_trades_user_id ON tradier_option_trades(user_id);
  END IF;
END $$;

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Users can only see their own data
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users see own trades" ON trades
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = trades.user_id 
      AND users.id = auth.uid()
    )
  );

CREATE POLICY "Users see own positions" ON positions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = positions.user_id 
      AND users.id = auth.uid()
    )
  );

-- Service role can do everything (for bot operations)
CREATE POLICY "Service role full access trades" ON trades
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access positions" ON positions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access users" ON users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon to read (for dashboard - adjust as needed)
CREATE POLICY "Anon read trades" ON trades
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon read positions" ON positions
  FOR SELECT TO anon USING (true);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to generate webhook secret
CREATE OR REPLACE FUNCTION generate_webhook_secret()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INITIAL ADMIN USER (Optional)
-- Create this manually via API, or run:
-- =====================================================
-- INSERT INTO users (email, password_hash, webhook_secret, name, subscription_tier)
-- VALUES (
--   'admin@example.com',
--   '$2b$10$...', -- Replace with actual bcrypt hash
--   generate_webhook_secret(),
--   'Admin User',
--   'pro'
-- );

-- =====================================================
-- SUCCESS!
-- =====================================================
-- Your multi-user schema is ready!
-- Next steps:
-- 1. Install npm dependencies (bcrypt, jsonwebtoken, etc.)
-- 2. Create user service and auth middleware
-- 3. Update webhook handler to use per-user secrets
-- 4. Test registration and login
-- =====================================================

