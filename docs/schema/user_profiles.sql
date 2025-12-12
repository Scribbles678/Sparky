create table public.user_profiles (
  id uuid not null,
  email text null,
  full_name text null,
  avatar_url text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  sparky_bot_url text null,
  constraint user_profiles_pkey primary key (id),
  constraint user_profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_user_profiles_sparky_bot_url on public.user_profiles using btree (sparky_bot_url) TABLESPACE pg_default
where
  (sparky_bot_url is not null);