DO $$
DECLARE
  runtime_password TEXT := current_setting('app.runtime_password');
BEGIN
  IF runtime_password !~ '^[A-Fa-f0-9]{64}$' THEN
    RAISE EXCEPTION 'APP_DB_PASSWORD precisa ser 32 bytes em hexadecimal.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_app') THEN
    EXECUTE format(
      'CREATE ROLE event_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
      runtime_password
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE event_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
      runtime_password
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_capacity_owner') THEN
    CREATE ROLE event_capacity_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE event_capacity_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  event_month DATE NOT NULL CHECK (EXTRACT(DAY FROM event_month) = 1),
  event_date DATE,
  start_time TIME NOT NULL,
  venue_name VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_date IS NULL OR date_trunc('month', event_date)::date = event_month)
);

CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY,
  event_key TEXT NOT NULL REFERENCES events(event_key),
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  interest VARCHAR(80),
  consent_at TIMESTAMPTZ NOT NULL,
  consent_version VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  CONSTRAINT registrations_event_email_unique UNIQUE (event_key, email)
);

CREATE INDEX IF NOT EXISTS registrations_event_created_idx
  ON registrations (event_key, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS event_capacity (
  event_key TEXT PRIMARY KEY REFERENCES events(event_key),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  registered_count INTEGER NOT NULL DEFAULT 0 CHECK (registered_count >= 0)
);
ALTER TABLE event_capacity OWNER TO event_capacity_owner;
GRANT USAGE ON SCHEMA public TO event_capacity_owner;
GRANT CREATE ON SCHEMA public TO event_capacity_owner;
GRANT SELECT, UPDATE ON public.event_capacity TO event_capacity_owner;
DO $$ BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.event_capacity TO %I', current_user);
END $$;

CREATE OR REPLACE FUNCTION reserve_event_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.event_capacity
     SET registered_count = registered_count + 1
   WHERE event_key = NEW.event_key
     AND (capacity IS NULL OR registered_count < capacity);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_FULL' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION reserve_event_capacity() OWNER TO event_capacity_owner;
REVOKE CREATE ON SCHEMA public FROM event_capacity_owner;
REVOKE ALL ON FUNCTION reserve_event_capacity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_event_capacity() TO event_app;

DROP TRIGGER IF EXISTS registrations_reserve_capacity ON registrations;
CREATE TRIGGER registrations_reserve_capacity
  BEFORE INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION reserve_event_capacity();

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE event_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_capacity FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_capacity_owner_scope ON event_capacity;
CREATE POLICY event_capacity_owner_scope ON event_capacity
  FOR ALL TO event_capacity_owner
  USING (event_key = current_setting('app.event_key', true))
  WITH CHECK (event_key = current_setting('app.event_key', true));

DROP POLICY IF EXISTS events_current_event ON events;
CREATE POLICY events_current_event ON events
  FOR SELECT TO event_app
  USING (event_key = current_setting('app.event_key', true));

DROP POLICY IF EXISTS registrations_public_insert ON registrations;
CREATE POLICY registrations_public_insert ON registrations
  FOR INSERT TO event_app
  WITH CHECK (event_key = current_setting('app.event_key', true));

DROP POLICY IF EXISTS registrations_admin_select ON registrations;
CREATE POLICY registrations_admin_select ON registrations
  FOR SELECT TO event_app
  USING (
    event_key = current_setting('app.event_key', true)
    AND EXISTS (
      SELECT 1 FROM admin_sessions AS active_session
      WHERE active_session.token_hash = current_setting('app.session_hash', true)
        AND active_session.expires_at > NOW()
    )
  );

DROP POLICY IF EXISTS registrations_admin_update ON registrations;
CREATE POLICY registrations_admin_update ON registrations
  FOR UPDATE TO event_app
  USING (
    event_key = current_setting('app.event_key', true)
    AND EXISTS (
      SELECT 1 FROM admin_sessions AS active_session
      WHERE active_session.token_hash = current_setting('app.session_hash', true)
        AND active_session.expires_at > NOW()
    )
  )
  WITH CHECK (event_key = current_setting('app.event_key', true));

DROP POLICY IF EXISTS admin_sessions_select_own ON admin_sessions;
CREATE POLICY admin_sessions_select_own ON admin_sessions
  FOR SELECT TO event_app
  USING (
    token_hash = current_setting('app.session_hash', true)
    AND expires_at > NOW()
  );

DROP POLICY IF EXISTS admin_sessions_insert_own ON admin_sessions;
CREATE POLICY admin_sessions_insert_own ON admin_sessions
  FOR INSERT TO event_app
  WITH CHECK (token_hash = current_setting('app.session_hash', true));

DROP POLICY IF EXISTS admin_sessions_delete_own ON admin_sessions;
CREATE POLICY admin_sessions_delete_own ON admin_sessions
  FOR DELETE TO event_app
  USING (token_hash = current_setting('app.session_hash', true));

REVOKE ALL ON events, registrations, admin_sessions, event_capacity FROM PUBLIC;
REVOKE ALL ON events, registrations, admin_sessions, event_capacity FROM event_app;
GRANT USAGE ON SCHEMA public TO event_app;
GRANT SELECT ON events TO event_app;
GRANT SELECT (id, event_key, full_name, email, phone, interest, created_at, checked_in_at)
  ON registrations TO event_app;
GRANT INSERT (id, event_key, full_name, email, phone, interest, consent_at, consent_version)
  ON registrations TO event_app;
GRANT UPDATE (checked_in_at) ON registrations TO event_app;
GRANT SELECT, INSERT, DELETE ON admin_sessions TO event_app;
