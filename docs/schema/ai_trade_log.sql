create table public.ai_trade_log (
  id uuid not null default gen_random_uuid (),
  ai_strategy_id uuid null,
  user_id uuid not null,
  decision_json jsonb not null,
  confidence_score numeric(4, 3) null,
  signal_action text not null,
  symbol text not null,
  size_usd numeric(14, 2) null,
  actual_pnl numeric(14, 2) null,
  reasoning text null,
  created_at timestamp with time zone null default now(),
  constraint ai_trade_log_pkey primary key (id),
  constraint ai_trade_log_ai_strategy_id_fkey foreign KEY (ai_strategy_id) references ai_strategies (id) on delete CASCADE,
  constraint ai_trade_log_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint ai_trade_log_confidence_score_check check (
    (
      (confidence_score >= (0)::numeric)
      and (confidence_score <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_ai_trade_log_strategy_id on public.ai_trade_log using btree (ai_strategy_id) TABLESPACE pg_default;

create index IF not exists idx_ai_trade_log_user_id on public.ai_trade_log using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_ai_trade_log_created_at on public.ai_trade_log using btree (created_at) TABLESPACE pg_default;