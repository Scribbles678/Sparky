-- Table: public.strategies

CREATE TABLE IF NOT EXISTS public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  name text NOT NULL,
  description text,
  asset_class public.asset_class_type,
  status text DEFAULT 'inactive',
  pine_script text,
  pine_script_version text DEFAULT 'v5',
  success_rate numeric(5, 2),
  avg_profit numeric(10, 2),
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  risk_level text,
  max_position_size_usd numeric(10, 2),
  stop_loss_percent numeric(5, 2),
  take_profit_percent numeric(5, 2),
  timeframe text,
  symbols text[],
  webhook_secret text,
  notes text,
  CONSTRAINT strategies_status_check CHECK (
    status = ANY (ARRAY['active', 'inactive', 'testing'])
  ),
  CONSTRAINT strategies_risk_level_check CHECK (
    risk_level = ANY (ARRAY['low', 'medium', 'high'])
  )
);

CREATE INDEX IF NOT EXISTS idx_strategies_status
  ON public.strategies (status);

CREATE INDEX IF NOT EXISTS idx_strategies_asset_class
  ON public.strategies (asset_class);

CREATE INDEX IF NOT EXISTS idx_strategies_name
  ON public.strategies (name);

-- Trigger maintained in Supabase:
-- CREATE TRIGGER strategies_updated_at BEFORE UPDATE ON strategies
--   FOR EACH ROW EXECUTE FUNCTION update_strategies_updated_at();

