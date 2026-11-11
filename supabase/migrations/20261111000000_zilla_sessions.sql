-- Zilla Milestones session store.
-- One row per visitor. The project jsonb holds phases, drafts, agent actions, and events.
-- Apply in the Supabase SQL editor or with the Supabase CLI.

create table if not exists public.zilla_sessions (
  id text primary key,
  project jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists zilla_sessions_updated_at_idx
  on public.zilla_sessions (updated_at desc);

alter table public.zilla_sessions enable row level security;

-- No policies on purpose. The anon key cannot read or write this table.
-- The Next.js server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses row level security.
-- Do not put that key in a NEXT_PUBLIC_ variable.
