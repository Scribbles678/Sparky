create table public.notifications (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  type text not null,
  title text not null,
  message text not null,
  metadata jsonb null default '{}'::jsonb,
  read boolean null default false,
  read_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  expires_at timestamp with time zone null,
  constraint notifications_pkey primary key (id),
  constraint notifications_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint notifications_type_check check (
    (
      type = any (
        array[
          'info'::text,
          'success'::text,
          'warning'::text,
          'error'::text,
          'trade'::text,
          'position'::text,
          'limit'::text,
          'system'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_notifications_user_id on public.notifications using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_notifications_user_unread on public.notifications using btree (user_id, read) TABLESPACE pg_default
where
  (read = false);

create index IF not exists idx_notifications_created_at on public.notifications using btree (created_at desc) TABLESPACE pg_default;