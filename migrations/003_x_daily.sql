-- X daily helper: read-only tracking of the admin's own X activity. Never posts anything.
CREATE TABLE IF NOT EXISTS weekendcheck.x_daily_state (
  id integer PRIMARY KEY CHECK (id = 1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  account_id text,
  account_username text NOT NULL DEFAULT '',
  newest_post_id text,
  newest_mention_id text,
  tracking_since timestamptz,
  search_day text NOT NULL DEFAULT '',
  search_token text NOT NULL DEFAULT '',
  sync_started_at timestamptz,
  sync_finished_at timestamptz,
  synced_at timestamptz,
  sync_error text NOT NULL DEFAULT ''
);
INSERT INTO weekendcheck.x_daily_state(id) VALUES (1) ON CONFLICT DO NOTHING;

-- Own posts and replies. Reposts are not stored.
CREATE TABLE IF NOT EXISTS weekendcheck.x_daily_activity (
  post_id text PRIMARY KEY CHECK (post_id ~ '^[0-9]{1,20}$'),
  created_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('post', 'reply', 'thread')),
  replied_to_user_id text CHECK (replied_to_user_id ~ '^[0-9]{1,20}$'),
  replied_to_post_id text CHECK (replied_to_post_id ~ '^[0-9]{1,20}$')
);
CREATE INDEX IF NOT EXISTS x_daily_activity_created ON weekendcheck.x_daily_activity(created_at DESC);

-- Everyone replied to, every suggested account, and every looked-up search author (never suggested twice).
CREATE TABLE IF NOT EXISTS weekendcheck.x_daily_people (
  user_id text PRIMARY KEY CHECK (user_id ~ '^[0-9]{1,20}$'),
  username text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  followers integer CHECK (followers >= 0),
  followers_checked_at timestamptz,
  first_replied_at timestamptz,
  last_replied_at timestamptz,
  warm text NOT NULL DEFAULT 'auto' CHECK (warm IN ('auto', 'pinned', 'hidden')),
  discovered_at timestamptz,
  discovery_source text CHECK (discovery_source IN ('mention', 'reply', 'search')),
  discovery_keyword text NOT NULL DEFAULT '',
  discovery_post_id text CHECK (discovery_post_id ~ '^[0-9]{1,20}$'),
  discovery_text text NOT NULL DEFAULT '',
  discovery_status text CHECK (discovery_status IN ('new', 'done', 'skipped'))
);
CREATE INDEX IF NOT EXISTS x_daily_people_discovery ON weekendcheck.x_daily_people(discovery_status, discovered_at DESC);

-- Billable X reads per local day, for the cost estimate and the daily caps.
CREATE TABLE IF NOT EXISTS weekendcheck.x_daily_usage (
  day date PRIMARY KEY,
  owned_reads integer NOT NULL DEFAULT 0,
  post_reads integer NOT NULL DEFAULT 0,
  user_reads integer NOT NULL DEFAULT 0
);

ALTER TABLE weekendcheck.x_daily_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekendcheck.x_daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekendcheck.x_daily_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekendcheck.x_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON weekendcheck.x_daily_state, weekendcheck.x_daily_activity, weekendcheck.x_daily_people, weekendcheck.x_daily_usage FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON weekendcheck.x_daily_state, weekendcheck.x_daily_activity, weekendcheck.x_daily_people, weekendcheck.x_daily_usage FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON weekendcheck.x_daily_state, weekendcheck.x_daily_activity, weekendcheck.x_daily_people, weekendcheck.x_daily_usage FROM authenticated; END IF;
END $$;
INSERT INTO weekendcheck.migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
