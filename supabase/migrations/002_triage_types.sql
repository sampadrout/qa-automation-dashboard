-- Admin users (must exist before triage_types policies reference it)
CREATE TABLE IF NOT EXISTS admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Anyone can check whether they are an admin
CREATE POLICY "read_admin_users" ON admin_users
  FOR SELECT TO authenticated USING (true);

-- Triage types (replaces hardcoded list in frontend)
CREATE TABLE IF NOT EXISTS triage_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  color       text NOT NULL DEFAULT '#9ca3af',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE triage_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_triage_types" ON triage_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_write_triage_types" ON triage_types
  FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Only service role (dashboard) can add/remove admins
-- (no INSERT/UPDATE/DELETE policy for authenticated role)

-- Seed initial triage types
INSERT INTO triage_types (name, color, sort_order) VALUES
  ('Untriaged',                   '#9ca3af',  0),
  ('Script Issue',                '#fbbf24',  1),
  ('Application Issue',           '#ef4444',  2),
  ('Environment Issue',           '#f97316',  3),
  ('Environment / Timeout Issue', '#fb923c',  4),
  ('Performance Issue',           '#a855f7',  5),
  ('Login Issue',                 '#ec4899',  6),
  ('Needs different login',       '#f472b6',  7),
  ('Timeout Issue',               '#f59e0b',  8),
  ('Data Issue',                  '#3b82f6',  9),
  ('Access Issue',                '#dc2626', 10),
  ('UI Change',                   '#6366f1', 11)
ON CONFLICT (name) DO NOTHING;
