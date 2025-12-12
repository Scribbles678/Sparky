create table public.strategies (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  name text not null,
  description text null,
  asset_class public.asset_class_type null,
  status text null default 'inactive'::text,
  total_trades integer null default 0,
  winning_trades integer null default 0,
  stop_loss_percent numeric(5, 2) null,
  take_profit_percent numeric(5, 2) null,
  notes text null,
  user_id uuid null,
  order_config jsonb null default '{}'::jsonb,
  constraint strategies_pkey primary key (id),
  constraint strategies_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint strategies_status_check check (
    (
      status = any (
        array['active'::text, 'inactive'::text, 'testing'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_strategies_user_id on public.strategies using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_strategies_status on public.strategies using btree (status) TABLESPACE pg_default;

create index IF not exists idx_strategies_asset_class on public.strategies using btree (asset_class) TABLESPACE pg_default;

create index IF not exists idx_strategies_name on public.strategies using btree (name) TABLESPACE pg_default;

create index IF not exists idx_strategies_user_id_status on public.strategies using btree (user_id, status) TABLESPACE pg_default;

create index IF not exists idx_strategies_user_id_asset_class on public.strategies using btree (user_id, asset_class) TABLESPACE pg_default;

create index IF not exists idx_strategies_order_config on public.strategies using gin (order_config) TABLESPACE pg_default;

create trigger strategies_updated_at BEFORE
update on strategies for EACH row
execute FUNCTION update_strategies_updated_at ();