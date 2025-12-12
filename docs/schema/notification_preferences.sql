create table public.notification_preferences (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  notify_trade_success boolean null default true,
  notify_trade_failed boolean null default true,
  notify_position_closed_profit boolean null default true,
  notify_position_closed_loss boolean null default true,
  notify_take_profit_triggered boolean null default true,
  notify_stop_loss_triggered boolean null default true,
  notify_weekly_trade_limit boolean null default true,
  notify_weekly_loss_limit boolean null default true,
  notify_webhook_limit_warning boolean null default true,
  notify_webhook_limit_reached boolean null default true,
  notify_exchange_api_error boolean null default true,
  notify_invalid_credentials boolean null default true,
  notify_bot_disconnected boolean null default true,
  notify_bot_reconnected boolean null default false,
  notify_payment_failed boolean null default true,
  notify_subscription_expiring boolean null default true,
  notify_subscription_changed boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint notification_preferences_pkey primary key (id),
  constraint notification_preferences_user_id_key unique (user_id),
  constraint notification_preferences_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_notification_preferences_user_id on public.notification_preferences using btree (user_id) TABLESPACE pg_default;