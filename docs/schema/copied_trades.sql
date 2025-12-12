create table public.copied_trades (
  id uuid not null default gen_random_uuid (),
  copy_relationship_id uuid not null,
  original_trade_id uuid null,
  follower_trade_id uuid null,
  follower_user_id uuid not null,
  leader_user_id uuid not null,
  leader_strategy_id uuid not null,
  symbol text not null,
  side text not null,
  leader_size_usd numeric(14, 2) not null,
  follower_size_usd numeric(14, 2) not null,
  pnl_usd numeric(14, 2) null default 0,
  pnl_percent numeric(8, 4) null default 0,
  is_winner boolean null default false,
  override_fee_charged numeric(14, 2) null default 0,
  platform_fee_usd numeric(14, 2) null default 0,
  leader_fee_usd numeric(14, 2) null default 0,
  fee_paid_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  entry_time timestamp with time zone null,
  exit_time timestamp with time zone null,
  constraint copied_trades_pkey primary key (id),
  constraint copied_trades_copy_relationship_id_fkey foreign KEY (copy_relationship_id) references copy_relationships (id) on delete CASCADE,
  constraint copied_trades_follower_user_id_fkey foreign KEY (follower_user_id) references auth.users (id) on delete CASCADE,
  constraint copied_trades_leader_strategy_id_fkey foreign KEY (leader_strategy_id) references ai_strategies (id) on delete CASCADE,
  constraint copied_trades_leader_user_id_fkey foreign KEY (leader_user_id) references auth.users (id) on delete CASCADE,
  constraint copied_trades_side_check check ((side = any (array['BUY'::text, 'SELL'::text])))
) TABLESPACE pg_default;

create index IF not exists idx_copied_trades_relationship on public.copied_trades using btree (copy_relationship_id) TABLESPACE pg_default;

create index IF not exists idx_copied_trades_follower on public.copied_trades using btree (follower_user_id) TABLESPACE pg_default;

create index IF not exists idx_copied_trades_leader on public.copied_trades using btree (leader_strategy_id) TABLESPACE pg_default;

create index IF not exists idx_copied_trades_fee_paid on public.copied_trades using btree (fee_paid_at) TABLESPACE pg_default
where
  (
    (fee_paid_at is null)
    and (pnl_usd > (0)::numeric)
  );