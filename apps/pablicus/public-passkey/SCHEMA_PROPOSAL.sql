-- REVIEWABLE PROPOSAL. Not applied to the live project by this file.
-- Apply only through the existing project's authorized migration connection.
-- Integration tests target PostgreSQL 16 and the observed production profile schema.
-- This installation intentionally fails on schema drift / a repeated installation.
-- The final SELECT emits a newly generated OAuth secret ONCE. Keep that result
-- in the provider's server configuration; never commit it or put it in the app.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles'
    AND column_name IN ('activation_pending','passkey_activation_pending')) THEN
    RAISE EXCEPTION 'profile provisioning changed; review migration before installation';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
    AND t.tgrelid = 'auth.identities'::regclass) THEN
    RAISE EXCEPTION 'identity provisioning changed; review existing triggers';
  END IF;
END;
$preflight$;

CREATE SCHEMA pablicus_passkey_private;
REVOKE ALL ON SCHEMA pablicus_passkey_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pablicus_passkey_private TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pablicus_passkey_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA pablicus_passkey_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE TABLE pablicus_passkey_private.configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  client_id text NOT NULL CHECK (client_id = 'pablicus-web'),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE pablicus_passkey_private.subjects (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pablicus_passkey_private.credentials (
  credential_id text PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9_-]{1,2048}$'),
  subject_id uuid NOT NULL REFERENCES pablicus_passkey_private.subjects(id) ON DELETE CASCADE,
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{1,8192}$'),
  counter bigint NOT NULL CHECK (counter BETWEEN 0 AND 4294967295),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transports) = 'array' AND jsonb_array_length(transports) <= 8),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pablicus_passkey_private.flows (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (char_length(state) BETWEEN 1 AND 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  redirect_uri text NOT NULL CHECK (redirect_uri = 'https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback'),
  expires_at timestamptz NOT NULL,
  kind text CHECK (kind IN ('registration','authentication')),
  challenge text CHECK (challenge ~ '^[A-Za-z0-9_-]{16,2048}$'),
  native_challenge_id text CHECK (char_length(native_challenge_id) BETWEEN 1 AND 256),
  subject_id uuid,
  display_name text CHECK (char_length(display_name) BETWEEN 1 AND 80),
  challenge_expires_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flows_expiry ON pablicus_passkey_private.flows(expires_at);
CREATE TABLE pablicus_passkey_private.codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  flow_id uuid UNIQUE NOT NULL REFERENCES pablicus_passkey_private.flows(id) ON DELETE CASCADE,
  userinfo jsonb NOT NULL CHECK (jsonb_typeof(userinfo) = 'object'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX codes_expiry ON pablicus_passkey_private.codes(expires_at);
CREATE TABLE pablicus_passkey_private.tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  userinfo jsonb NOT NULL CHECK (jsonb_typeof(userinfo) = 'object'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX tokens_expiry ON pablicus_passkey_private.tokens(expires_at);
CREATE TABLE pablicus_passkey_private.rate_buckets (
  bucket_key text PRIMARY KEY CHECK (char_length(bucket_key) BETWEEN 1 AND 180 AND bucket_key ~ '^[A-Za-z0-9_:-]+$'),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);
CREATE INDEX rate_buckets_expiry ON pablicus_passkey_private.rate_buckets(window_start);

-- Defense in depth: no browser grants, and no browser-role RLS policies.
DO $roles$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['configuration','subjects','credentials','flows','codes','tokens','rate_buckets'] LOOP
    EXECUTE format('ALTER TABLE pablicus_passkey_private.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE pablicus_passkey_private.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pablicus_passkey_private.%I TO service_role', table_name);
    EXECUTE format('CREATE POLICY service_only ON pablicus_passkey_private.%I TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$roles$;

CREATE FUNCTION pablicus_passkey_private.flow_json(value pablicus_passkey_private.flows)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT jsonb_build_object('id', (value).id, 'state', (value).state,
    'codeChallenge', (value).code_challenge, 'redirectUri', (value).redirect_uri,
    'expiresAt', (value).expires_at, 'kind', (value).kind, 'challenge', (value).challenge,
    'nativeChallengeId', (value).native_challenge_id, 'subjectId', (value).subject_id,
    'name', (value).display_name, 'challengeExpiresAt', (value).challenge_expires_at);
$function$;
REVOKE ALL ON FUNCTION pablicus_passkey_private.flow_json(pablicus_passkey_private.flows) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pablicus_passkey_private.flow_json(pablicus_passkey_private.flows) TO service_role;

-- The only Data API surface. Invoker privileges remain those of service_role.
-- Claims in payload or request.jwt.claims cannot turn anon into service_role.
CREATE FUNCTION public.pablicus_passkey_store(operation text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  flow pablicus_passkey_private.flows%ROWTYPE;
  key_row pablicus_passkey_private.credentials%ROWTYPE;
  subject_row pablicus_passkey_private.subjects%ROWTYPE;
  code_row pablicus_passkey_private.codes%ROWTYPE;
  config_row pablicus_passkey_private.configuration%ROWTYPE;
  result jsonb;
  identity_info jsonb;
  time_now timestamptz := clock_timestamp();
  deadline timestamptz;
  affected integer;
  old_counter bigint;
  new_counter bigint;
  window_seconds integer;
  request_limit integer;
  window_time timestamptz;
  request_hits integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(payload) <> 'object' OR octet_length(payload::text) > 40000 THEN
    RAISE EXCEPTION 'invalid payload' USING ERRCODE = '22023';
  END IF;
  IF operation = 'config' THEN
    SELECT jsonb_build_object('clientId', client_id, 'secretHash', secret_hash, 'enabled', enabled)
      INTO result FROM pablicus_passkey_private.configuration WHERE singleton;
    RETURN result;
  END IF;
  SELECT * INTO config_row FROM pablicus_passkey_private.configuration WHERE singleton AND enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Clamp bounded caller timestamps to DB time; allow at most 5 seconds of
  -- inter-service clock skew without extending the actual stored TTL.
  IF operation = 'createFlow' THEN
    deadline := (payload->>'expiresAt')::timestamptz;
    IF deadline <= time_now OR deadline > time_now + interval '305 seconds' THEN RETURN 'false'::jsonb; END IF;
    deadline := least(deadline, time_now + interval '5 minutes');
    INSERT INTO pablicus_passkey_private.flows(id, secret_hash, state, code_challenge, redirect_uri, expires_at)
      VALUES ((payload->>'id')::uuid, payload->>'secretHash', payload->>'state', payload->>'codeChallenge', payload->>'redirectUri', deadline);
    RETURN 'true'::jsonb;
  ELSIF operation = 'readFlow' THEN
    SELECT * INTO flow FROM pablicus_passkey_private.flows
      WHERE id = (payload->>'id')::uuid AND secret_hash = payload->>'secretHash'
        AND completed_at IS NULL AND expires_at > time_now;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN pablicus_passkey_private.flow_json(flow);
  ELSIF operation = 'setChallenge' THEN
    deadline := (payload->>'expiresAt')::timestamptz;
    IF deadline <= time_now OR deadline > time_now + interval '125 seconds'
       OR payload->>'kind' NOT IN ('registration','authentication') THEN RETURN 'false'::jsonb; END IF;
    IF payload->>'kind' = 'registration' AND (payload->>'subjectId' IS NULL OR nullif(btrim(payload->>'name'), '') IS NULL)
      THEN RETURN 'false'::jsonb; END IF;
    IF payload->>'kind' = 'authentication' AND nullif(payload->>'nativeChallengeId','') IS NULL THEN RETURN 'false'::jsonb; END IF;
    UPDATE pablicus_passkey_private.flows SET
      kind = payload->>'kind', challenge = payload->>'challenge',
      native_challenge_id = payload->>'nativeChallengeId',
      subject_id = (payload->>'subjectId')::uuid, display_name = payload->>'name',
      challenge_expires_at = least(deadline, expires_at, time_now + interval '2 minutes')
      WHERE id = (payload->>'id')::uuid AND secret_hash = payload->>'secretHash'
        AND claimed_at IS NULL AND completed_at IS NULL AND expires_at > time_now;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN to_jsonb(affected = 1);
  ELSIF operation = 'claimChallenge' THEN
    SELECT * INTO flow FROM pablicus_passkey_private.flows
      WHERE id = (payload->>'id')::uuid AND secret_hash = payload->>'secretHash' FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    time_now := clock_timestamp();
    IF flow.kind IS DISTINCT FROM payload->>'kind' OR flow.challenge IS NULL
       OR flow.claimed_at IS NOT NULL OR flow.completed_at IS NOT NULL
       OR flow.expires_at <= time_now OR flow.challenge_expires_at <= time_now THEN RETURN NULL; END IF;
    UPDATE pablicus_passkey_private.flows SET claimed_at = time_now WHERE id = flow.id;
    RETURN pablicus_passkey_private.flow_json(flow);
  ELSIF operation = 'findCredential' THEN
    SELECT jsonb_build_object('credentialId', c.credential_id, 'publicKey', c.public_key,
        'counter', c.counter, 'transports', c.transports, 'subjectId', s.id, 'name', s.display_name)
      INTO result FROM pablicus_passkey_private.credentials c
      JOIN pablicus_passkey_private.subjects s ON s.id = c.subject_id
      WHERE c.credential_id = payload->>'credentialId';
    RETURN result;
  ELSIF operation IN ('completeRegistration','completeAuthentication') THEN
    SELECT * INTO flow FROM pablicus_passkey_private.flows WHERE id = (payload->>'flowId')::uuid FOR UPDATE;
    time_now := clock_timestamp();
    IF NOT FOUND OR flow.completed_at IS NOT NULL OR flow.claimed_at IS NULL
       OR flow.expires_at <= time_now OR flow.challenge_expires_at <= time_now THEN RETURN 'false'::jsonb; END IF;
    deadline := (payload->>'codeExpiresAt')::timestamptz;
    IF deadline <= time_now OR deadline > time_now + interval '65 seconds' THEN RETURN 'false'::jsonb; END IF;
    deadline := least(deadline, time_now + interval '60 seconds');
    IF operation = 'completeRegistration' THEN
      IF flow.kind <> 'registration' OR flow.subject_id::text IS DISTINCT FROM payload->>'subjectId'
         OR flow.display_name IS DISTINCT FROM payload->>'name' THEN RETURN 'false'::jsonb; END IF;
      INSERT INTO pablicus_passkey_private.subjects(id, display_name) VALUES (flow.subject_id, flow.display_name);
      INSERT INTO pablicus_passkey_private.credentials(credential_id, subject_id, public_key, counter, transports)
        VALUES(payload->'credential'->>'credentialId', flow.subject_id, payload->'credential'->>'publicKey',
          (payload->'credential'->>'counter')::bigint, coalesce(payload->'credential'->'transports', '[]'::jsonb));
      identity_info := jsonb_build_object('sub', flow.subject_id::text, 'name', flow.display_name);
    ELSE
      IF flow.kind <> 'authentication' THEN RETURN 'false'::jsonb; END IF;
      IF payload->>'credentialId' IS NOT NULL THEN
        SELECT * INTO key_row FROM pablicus_passkey_private.credentials
          WHERE credential_id = payload->>'credentialId' FOR UPDATE;
        IF NOT FOUND OR key_row.subject_id::text IS DISTINCT FROM payload->>'subjectId' THEN RETURN 'false'::jsonb; END IF;
        time_now := clock_timestamp();
        IF flow.expires_at <= time_now OR flow.challenge_expires_at <= time_now OR deadline <= time_now THEN RETURN 'false'::jsonb; END IF;
        old_counter := (payload->>'oldCounter')::bigint;
        new_counter := (payload->>'newCounter')::bigint;
        IF old_counter IS NULL OR new_counter IS NULL OR key_row.counter <> old_counter
           OR new_counter < 0 OR new_counter > 4294967295
           OR ((old_counter <> 0 OR new_counter <> 0) AND new_counter <= old_counter) THEN RETURN 'false'::jsonb; END IF;
        SELECT * INTO subject_row FROM pablicus_passkey_private.subjects WHERE id = key_row.subject_id;
        identity_info := jsonb_build_object('sub', subject_row.id::text, 'name', subject_row.display_name);
        UPDATE pablicus_passkey_private.credentials SET counter = new_counter WHERE credential_id = key_row.credential_id;
      ELSE
        -- Native assertions are verified exclusively by the trusted handler
        -- through official Auth APIs. This RPC never reads Auth key material.
        identity_info := payload->'userinfo';
        IF payload->>'subjectId' !~ '^native:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
           OR identity_info->>'sub' IS DISTINCT FROM payload->>'subjectId'
           OR identity_info->'email_verified' IS DISTINCT FROM 'true'::jsonb
           OR jsonb_typeof(identity_info->'email') IS DISTINCT FROM 'string'
           OR coalesce(char_length(identity_info->>'email'), 0) NOT BETWEEN 3 AND 320
           OR position('@' in identity_info->>'email') <= 1
           OR jsonb_typeof(identity_info->'name') IS DISTINCT FROM 'string'
           OR char_length(identity_info->>'name') > 80
           OR identity_info - ARRAY['sub','name','email','email_verified']::text[] <> '{}'::jsonb
           THEN RETURN 'false'::jsonb; END IF;
      END IF;
    END IF;
    INSERT INTO pablicus_passkey_private.codes(code_hash, flow_id, userinfo, expires_at)
      VALUES(payload->>'codeHash', flow.id, identity_info, deadline);
    UPDATE pablicus_passkey_private.flows SET completed_at = time_now WHERE id = flow.id;
    RETURN 'true'::jsonb;
  ELSIF operation = 'exchangeCode' THEN
    deadline := (payload->>'tokenExpiresAt')::timestamptz;
    IF payload->>'clientId' IS DISTINCT FROM config_row.client_id
       OR deadline <= time_now OR deadline > time_now + interval '65 seconds' THEN RETURN 'false'::jsonb; END IF;
    deadline := least(deadline, time_now + interval '60 seconds');
    SELECT c.* INTO code_row FROM pablicus_passkey_private.codes c
      JOIN pablicus_passkey_private.flows f ON f.id = c.flow_id
      WHERE c.code_hash = payload->>'codeHash' AND c.consumed_at IS NULL AND c.expires_at > time_now
        AND f.code_challenge = payload->>'codeChallenge' AND f.redirect_uri = payload->>'redirectUri'
      FOR UPDATE OF c;
    IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
    time_now := clock_timestamp();
    IF code_row.expires_at <= time_now OR deadline <= time_now THEN RETURN 'false'::jsonb; END IF;
    INSERT INTO pablicus_passkey_private.tokens(token_hash,userinfo,expires_at)
      VALUES(payload->>'tokenHash', code_row.userinfo, deadline);
    UPDATE pablicus_passkey_private.codes SET consumed_at = time_now WHERE code_hash = code_row.code_hash;
    RETURN 'true'::jsonb;
  ELSIF operation = 'userinfo' THEN
    SELECT userinfo INTO result FROM pablicus_passkey_private.tokens
      WHERE token_hash = payload->>'tokenHash' AND expires_at > time_now;
    RETURN result;
  ELSIF operation = 'rateLimit' THEN
    request_limit := (payload->>'limit')::integer;
    window_seconds := (payload->>'windowSeconds')::integer;
    IF request_limit IS NULL OR request_limit NOT BETWEEN 1 AND 10000
       OR window_seconds IS NULL OR window_seconds NOT BETWEEN 1 AND 3600 THEN RETURN 'false'::jsonb; END IF;
    window_time := to_timestamp(floor(extract(epoch FROM time_now) / window_seconds) * window_seconds);
    INSERT INTO pablicus_passkey_private.rate_buckets(bucket_key,window_start,hits)
      VALUES(payload->>'key',window_time,1)
      ON CONFLICT (bucket_key) DO UPDATE SET
        window_start = excluded.window_start,
        hits = CASE WHEN rate_buckets.window_start = excluded.window_start THEN least(rate_buckets.hits + 1, 10001) ELSE 1 END
      RETURNING hits INTO request_hits;
    -- Bounded cleanup prevents unbounded abandoned challenges and buckets.
    -- Keep completed flow rows long enough for all 60-second OAuth tokens.
    DELETE FROM pablicus_passkey_private.flows WHERE id IN (
      SELECT id FROM pablicus_passkey_private.flows WHERE expires_at < time_now - interval '5 minutes' LIMIT 200);
    DELETE FROM pablicus_passkey_private.tokens WHERE token_hash IN (
      SELECT token_hash FROM pablicus_passkey_private.tokens WHERE expires_at < time_now LIMIT 200);
    DELETE FROM pablicus_passkey_private.rate_buckets WHERE bucket_key IN (
      SELECT bucket_key FROM pablicus_passkey_private.rate_buckets WHERE window_start < time_now - interval '2 hours' LIMIT 200);
    RETURN to_jsonb(request_hits <= request_limit);
  END IF;
  RAISE EXCEPTION 'unknown operation' USING ERRCODE = '22023';
EXCEPTION WHEN unique_violation THEN
  -- Roll back this completion/exchange atomically; the challenge claim made
  -- by the earlier RPC stays consumed. No orphan subject or token is issued.
  RETURN 'false'::jsonb;
END;
$function$;
REVOKE ALL ON FUNCTION public.pablicus_passkey_store(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pablicus_passkey_store(text,jsonb) TO service_role;

-- Existing profiles start with false. Never backfill or reapprove old accounts.
ALTER TABLE public.profiles ADD COLUMN passkey_activation_pending boolean NOT NULL DEFAULT false;
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (is_approved, passkey_activation_pending) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (username, display_name, avatar_url) ON public.profiles TO authenticated;

-- Same existing Auth-trigger entry point; no duplicate user-created trigger.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  base_name text;
  candidate text;
  attempt integer;
  conflict_constraint text;
BEGIN
  -- Presentation metadata never grants authority. All new profiles start
  -- unapproved; the exact trusted custom-provider identity activates them.
  base_name := left(regexp_replace(lower(coalesce(nullif(NEW.raw_user_meta_data->>'username',''), split_part(coalesce(NEW.email,''),'@',1))), '[^a-z0-9_]', '', 'g'),24);
  IF coalesce(char_length(base_name),0) < 3 THEN
    base_name := 'u_' || left(replace(NEW.id::text,'-',''),22);
  END IF;
  FOR attempt IN 0..7 LOOP
    candidate := CASE WHEN attempt = 0 THEN base_name ELSE left(base_name,15) || '_' || left(md5(NEW.id::text || ':' || attempt::text),8) END;
    BEGIN
      INSERT INTO public.profiles(id,username,display_name,is_approved,passkey_activation_pending)
        VALUES(NEW.id,candidate,left(nullif(btrim(NEW.raw_user_meta_data->>'name'),''),80),false,
          NOT coalesce(NEW.is_anonymous,false) AND coalesce(NEW.email,'') = '' AND coalesce(NEW.phone,'') = '')
        ON CONFLICT(id) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS conflict_constraint = CONSTRAINT_NAME;
      IF conflict_constraint <> 'profiles_username_key' THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'could not allocate profile username';
END;
$function$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION pablicus_passkey_private.consume_profile_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  -- Even an explicit false->false admin denial consumes one-time eligibility.
  NEW.passkey_activation_pending := false;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_passkey_private.consume_profile_activation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profile_approval_consumes_passkey_activation
BEFORE UPDATE OF is_approved ON public.profiles FOR EACH ROW
EXECUTE FUNCTION pablicus_passkey_private.consume_profile_activation();

CREATE FUNCTION pablicus_passkey_private.activate_passkey_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE affected integer; eligible_id uuid;
BEGIN
  IF NEW.provider <> 'custom:pablicus-passkey'
    OR NEW.provider_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN NEW; END IF;
  -- Lock the user and profile while deciding eligibility so concurrent Auth
  -- bans or explicit profile denials cannot race this activation decision.
  SELECT p.id INTO eligible_id FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.id = NEW.user_id AND NOT coalesce(u.is_anonymous,false)
      AND coalesce(u.email,'') = '' AND coalesce(u.phone,'') = ''
      AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
      AND p.passkey_activation_pending AND NOT p.is_approved
    FOR UPDATE OF u, p;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Require a real server-recorded subject. Native:<uuid> bridge identities
  -- cannot activate profiles or create replacement users in this trigger.
  UPDATE pablicus_passkey_private.subjects SET auth_user_id = NEW.user_id
    WHERE id = NEW.provider_id::uuid AND (auth_user_id IS NULL OR auth_user_id = NEW.user_id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RETURN NEW; END IF;
  UPDATE public.profiles SET is_approved = true, passkey_activation_pending = false
    WHERE id = NEW.user_id AND passkey_activation_pending AND NOT is_approved;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION pablicus_passkey_private.activate_passkey_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER passkey_identity_activates_pending_profile
AFTER INSERT ON auth.identities FOR EACH ROW
EXECUTE FUNCTION pablicus_passkey_private.activate_passkey_identity();

-- No auth.users/auth.identities writes, no auth credential-table reads, no
-- conversation/message/storage policy or membership changes occur here.
-- pgcrypto is already available under extensions on the observed project.
WITH fresh AS MATERIALIZED (
  SELECT rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=') AS secret
), installed AS (
  INSERT INTO pablicus_passkey_private.configuration(singleton,client_id,secret_hash,enabled)
    SELECT true,'pablicus-web',encode(extensions.digest(secret,'sha256'),'hex'),true FROM fresh
    RETURNING client_id
)
SELECT installed.client_id AS oauth_client_id, fresh.secret AS oauth_client_secret
FROM installed CROSS JOIN fresh;
COMMIT;
