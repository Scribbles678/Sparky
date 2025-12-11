-- 2025-12-11 AI Trading Firm Core Tables
-- Run this once via Supabase SQL Editor or CLI
-- This migration adds AI strategy management and trade logging

-- AI Strategies Table
-- Stores user-configured AI trading strategies
create table if not exists public.ai_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'My AI Strategy',
  status text default 'paused' check (status in ('running', 'paused', 'backtesting', 'terminated')),
  risk_profile text default 'balanced' check (risk_profile in ('conservative', 'balanced', 'aggressive')),
  target_assets text[] default '{BTCUSDT,ETHUSDT,SOLUSDT}',
  max_drawdown_percent numeric(5,2) default 20.00,
  target_sharpe numeric(4,2) default 1.60,
  leverage_max integer default 10,
  performance_fee_percent numeric(4,2) default 20.00,
  is_prop_allocation boolean default false,
  is_paper_trading boolean default false, -- For testing
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- AI Trade Log Table
-- Stores all AI decisions for audit, training, and analysis
create table if not exists public.ai_trade_log (
  id uuid primary key default gen_random_uuid(),
  ai_strategy_id uuid references public.ai_strategies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  decision_json jsonb not null,
  confidence_score numeric(4,3) check (confidence_score between 0 and 1),
  signal_action text not null,
  symbol text not null,
  size_usd numeric(14,2),
  actual_pnl numeric(14,2), -- Updated after trade closes
  reasoning text,
  created_at timestamp with time zone default now()
);

-- Indexes for performance
create index if not exists idx_ai_strategies_user_id on public.ai_strategies(user_id);
create index if not exists idx_ai_strategies_status on public.ai_strategies(status);
create index if not exists idx_ai_trade_log_strategy_id on public.ai_trade_log(ai_strategy_id);
create index if not exists idx_ai_trade_log_user_id on public.ai_trade_log(user_id);
create index if not exists idx_ai_trade_log_created_at on public.ai_trade_log(created_at);

-- Row Level Security (RLS)
alter table public.ai_strategies enable row level security;
alter table public.ai_trade_log enable row level security;

-- RLS Policies: Users can only see/manage their own strategies
create policy "Users can manage own AI strategies"
  on public.ai_strategies
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can view own AI trade log"
  on public.ai_trade_log
  using (auth.uid() = user_id);

-- Service role can access all (for AI worker)
create policy "Service role full access ai_strategies"
  on public.ai_strategies
  for all
  to service_role
  using (true)
  with check (true);

create policy "Service role full access ai_trade_log"
  on public.ai_trade_log
  for all
  to service_role
  using (true)
  with check (true);

-- Function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to auto-update updated_at
create trigger update_ai_strategies_updated_at
  before update on public.ai_strategies
  for each row
  execute function update_updated_at_column();

-- Helper function: Get active strategies (for AI worker)
create or replace function get_active_ai_strategies()
returns table (
  id uuid,
  user_id uuid,
  name text,
  status text,
  risk_profile text,
  target_assets text[],
  max_drawdown_percent numeric,
  leverage_max integer,
  performance_fee_percent numeric
) as $$
begin
  return query
  select 
    s.id,
    s.user_id,
    s.name,
    s.status,
    s.risk_profile,
    s.target_assets,
    s.max_drawdown_percent,
    s.leverage_max,
    s.performance_fee_percent
  from public.ai_strategies s
  where s.status = 'running';
end;
$$ language plpgsql security definer;

-- Comments for documentation
comment on table public.ai_strategies is 'User-configured AI trading strategies';
comment on table public.ai_trade_log is 'Audit log of all AI trading decisions';
comment on column public.ai_strategies.is_paper_trading is 'If true, AI decisions are logged but not executed';
comment on column public.ai_trade_log.actual_pnl is 'Updated after trade closes, links to trades table';

