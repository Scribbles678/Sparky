create table public.ai_strategies (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  name text not null default 'My AI Strategy'::text,
  status text null default 'paused'::text,
  risk_profile text null default 'balanced'::text,
  target_assets text[] null default '{BTCUSDT,ETHUSDT,SOLUSDT}'::text[],
  max_drawdown_percent numeric(5, 2) null default 20.00,
  target_sharpe numeric(4, 2) null default 1.60,
  leverage_max integer null default 10,
  performance_fee_percent numeric(4, 2) null default 20.00,
  is_prop_allocation boolean null default false,
  is_paper_trading boolean null default false,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  copy_override_percent numeric(4, 2) null default 15.00,
  is_public_leader boolean null default false,
  verified_badge boolean null default false,
  copiers_count integer null default 0,
  constraint ai_strategies_pkey primary key (id),
  constraint ai_strategies_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint ai_strategies_risk_profile_check check (
    (
      risk_profile = any (
        array[
          'conservative'::text,
          'balanced'::text,
          'aggressive'::text
        ]
      )
    )
  ),
  constraint ai_strategies_status_check check (
    (
      status = any (
        array[
          'running'::text,
          'paused'::text,
          'backtesting'::text,
          'terminated'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_ai_strategies_public_leaders on public.ai_strategies using btree (is_public_leader, status) TABLESPACE pg_default
where
  (
    (is_public_leader = true)
    and (status = 'running'::text)
  );

create index IF not exists idx_ai_strategies_user_id on public.ai_strategies using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_ai_strategies_status on public.ai_strategies using btree (status) TABLESPACE pg_default;

create trigger update_ai_strategies_updated_at BEFORE
update on ai_strategies for EACH row
execute FUNCTION update_updated_at_column ();