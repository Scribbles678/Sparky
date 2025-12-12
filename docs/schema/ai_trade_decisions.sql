create table public.ai_trade_decisions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  strategy_id uuid not null,
  decided_at timestamp with time zone null default now(),
  market_snapshot jsonb not null,
  orderbook_snapshot jsonb null,
  onchain_snapshot jsonb null,
  technical_indicators jsonb not null,
  portfolio_state jsonb not null default '{}'::jsonb,
  model_versions text[] not null default '{llama-3.1-70b}'::text[],
  raw_responses jsonb null,
  parsed_decision jsonb not null,
  confidence_final numeric(4, 3) null,
  signal_sent boolean null default false,
  pnl_1h numeric(14, 2) null,
  pnl_24h numeric(14, 2) null,
  max_favorable_excursion numeric(14, 2) null,
  max_adverse_excursion numeric(14, 2) null,
  outcome_label text GENERATED ALWAYS as (
    case
      when (pnl_1h > (0)::numeric) then 'positive'::text
      when (pnl_1h < (0)::numeric) then 'negative'::text
      else 'neutral'::text
    end
  ) STORED null,
  created_at timestamp with time zone null default now(),
  constraint ai_trade_decisions_pkey primary key (id),
  constraint ai_trade_decisions_strategy_id_fkey foreign KEY (strategy_id) references ai_strategies (id) on delete CASCADE,
  constraint ai_trade_decisions_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint ai_trade_decisions_confidence_final_check check (
    (
      (confidence_final >= (0)::numeric)
      and (confidence_final <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_decisions_user_strategy on public.ai_trade_decisions using btree (user_id, strategy_id) TABLESPACE pg_default;

create index IF not exists idx_decisions_time on public.ai_trade_decisions using btree (decided_at desc) TABLESPACE pg_default;

create index IF not exists idx_decisions_outcome on public.ai_trade_decisions using btree (outcome_label) TABLESPACE pg_default;