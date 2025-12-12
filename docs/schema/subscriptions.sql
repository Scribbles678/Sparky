create table public.subscriptions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  plan text not null default 'Free'::text,
  status text not null default 'active'::text,
  stripe_subscription_id text null,
  stripe_customer_id text null,
  stripe_price_id text null,
  current_period_start timestamp with time zone null,
  current_period_end timestamp with time zone null,
  cancel_at_period_end boolean null default false,
  canceled_at timestamp with time zone null,
  trial_start timestamp with time zone null,
  trial_end timestamp with time zone null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint subscriptions_pkey primary key (id),
  constraint subscriptions_user_id_key unique (user_id),
  constraint subscriptions_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_subscriptions_user_id on public.subscriptions using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_subscriptions_status on public.subscriptions using btree (status) TABLESPACE pg_default;

create index IF not exists idx_subscriptions_plan on public.subscriptions using btree (plan) TABLESPACE pg_default;

create index IF not exists idx_subscriptions_stripe_subscription_id on public.subscriptions using btree (stripe_subscription_id) TABLESPACE pg_default;

create index IF not exists idx_subscriptions_stripe_customer_id on public.subscriptions using btree (stripe_customer_id) TABLESPACE pg_default;

create trigger update_subscriptions_updated_at BEFORE
update on subscriptions for EACH row
execute FUNCTION update_subscriptions_updated_at ();