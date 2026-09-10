-- Applied to ctcoqgsztdtsazdiwcmd as 20260910100400_public_bot_core_cloud_pilot_v1.
-- Additive storage; not a backup of the pre-existing messenger database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS public_bot_private;
REVOKE ALL ON SCHEMA public_bot_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public_bot_private TO service_role;
CREATE TABLE IF NOT EXISTS public_bot_private.bots (
 id text PRIMARY KEY,owner_id text NOT NULL,status text NOT NULL CHECK(status IN ('active','stopped')),
 visibility text NOT NULL CHECK(visibility IN ('private','public')),revision integer NOT NULL CHECK(revision>0),doc jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bots_owner ON public_bot_private.bots(owner_id);
CREATE TABLE IF NOT EXISTS public_bot_private.sessions (
 id text PRIMARY KEY,bot_id text NOT NULL REFERENCES public_bot_private.bots(id),actor_id text NOT NULL,
 revision integer NOT NULL DEFAULT 0,doc jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_actor_bot ON public_bot_private.sessions(actor_id,bot_id);
CREATE TABLE IF NOT EXISTS public_bot_private.events (
 session_id text NOT NULL REFERENCES public_bot_private.sessions(id) ON DELETE CASCADE,
 event_id text NOT NULL,fingerprint text NOT NULL,revision integer NOT NULL,response jsonb NOT NULL,input jsonb NOT NULL,
 PRIMARY KEY(session_id,event_id),UNIQUE(session_id,revision)
);
CREATE TABLE IF NOT EXISTS public_bot_private.records (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id text NOT NULL UNIQUE,
 bot_id text NOT NULL REFERENCES public_bot_private.bots(id),session_id text NOT NULL REFERENCES public_bot_private.sessions(id) ON DELETE CASCADE,
 actor_id text NOT NULL,event_id text NOT NULL,item_index integer NOT NULL,doc jsonb NOT NULL,
 UNIQUE(session_id,event_id,item_index)
);
CREATE INDEX IF NOT EXISTS records_bot ON public_bot_private.records(bot_id,seq);
CREATE TABLE IF NOT EXISTS public_bot_private.keys (
 id text PRIMARY KEY,hash text NOT NULL UNIQUE,owner_id text NOT NULL,actor_id text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('manage','chat')),bot_id text REFERENCES public_bot_private.bots(id),label text NOT NULL,
 expires_at bigint NOT NULL,revoked_at bigint,created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS keys_owner ON public_bot_private.keys(owner_id);
CREATE TABLE IF NOT EXISTS public_bot_private.quota_buckets (key text PRIMARY KEY,count integer NOT NULL,reset_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS quota_reset ON public_bot_private.quota_buckets(reset_at);
ALTER TABLE public_bot_private.bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_bot_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_bot_private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_bot_private.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_bot_private.keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_bot_private.quota_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public_bot_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public_bot_private FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public_bot_private TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public_bot_private TO service_role;
CREATE OR REPLACE FUNCTION public.public_bot_store_v1(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 op text:=payload->>'op'; b jsonb; s jsonb; t jsonb; k jsonb; out jsonb; existing jsonb; item jsonb;
 n bigint; ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 idv text; expected integer;
BEGIN
 CASE op
 WHEN 'getBot' THEN
   SELECT doc INTO out FROM public_bot_private.bots WHERE id=payload->>'id'; RETURN out;
 WHEN 'listBots' THEN
   SELECT coalesce(jsonb_agg(doc ORDER BY created_at DESC,id),'[]'::jsonb) INTO out FROM
    (SELECT doc,created_at,id FROM public_bot_private.bots WHERE owner_id=payload->>'owner' ORDER BY created_at DESC,id LIMIT 100) q; RETURN out;
 WHEN 'catalog' THEN
   SELECT coalesce(jsonb_agg(doc ORDER BY created_at DESC,id),'[]'::jsonb) INTO out FROM
    (SELECT doc,created_at,id FROM public_bot_private.bots WHERE (owner_id=payload->>'actor' OR visibility='public') AND status='active' ORDER BY created_at DESC,id LIMIT 100) q; RETURN out;
 WHEN 'createBot' THEN
   b:=payload->'bot'; PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot-owner:'||(b->>'owner_id'),0));
   SELECT count(*) INTO n FROM public_bot_private.bots WHERE owner_id=b->>'owner_id';
   IF n>=50 THEN RAISE EXCEPTION 'BOT_LIMIT'; END IF;
   INSERT INTO public_bot_private.bots(id,owner_id,status,visibility,revision,doc) VALUES(b->>'id',b->>'owner_id',b->>'status',b->>'visibility',(b->>'revision')::integer,b); RETURN b;
 WHEN 'updateBot' THEN
   b:=payload->'bot';PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot:'||(b->>'id'),0));
   UPDATE public_bot_private.bots SET status=b->>'status',visibility=b->>'visibility',revision=(b->>'revision')::integer,doc=b
     WHERE id=b->>'id' AND owner_id=b->>'owner_id' AND revision=(payload->>'expected')::integer;
   IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;RETURN b;
 WHEN 'getSession' THEN SELECT doc INTO out FROM public_bot_private.sessions WHERE id=payload->>'id'; RETURN out;
 WHEN 'listSessions' THEN
   SELECT coalesce(jsonb_agg(doc ORDER BY created_at DESC,id),'[]'::jsonb) INTO out FROM
   (SELECT doc,created_at,id FROM public_bot_private.sessions WHERE actor_id=payload->>'actor' AND bot_id=payload->>'bot' ORDER BY created_at DESC,id LIMIT 100) q; RETURN out;
 WHEN 'createSession' THEN
   s:=payload->'session';
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('actor:'||(s->>'actor_id'),0));
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot:'||(s->>'bot_id'),0));
   SELECT doc INTO b FROM public_bot_private.bots WHERE id=s->>'bot_id';
   IF b IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   SELECT doc INTO out FROM public_bot_private.sessions WHERE id=s->>'id';
   IF out IS NOT NULL THEN
     IF out->>'actor_id'<>s->>'actor_id' OR out->>'bot_id'<>s->>'bot_id' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;RETURN out;
   END IF;
   IF b->>'status'<>'active' THEN RAISE EXCEPTION 'BOT_STOPPED'; END IF;
   IF b->>'owner_id'<>s->>'actor_id' AND b->>'visibility'<>'public' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   SELECT count(*) INTO n FROM public_bot_private.sessions WHERE actor_id=s->>'actor_id'; IF n>=500 THEN RAISE EXCEPTION 'CHAT_LIMIT'; END IF;
   s:=s||jsonb_build_object('flow',b->'flow','flow_revision',b->'revision');
   INSERT INTO public_bot_private.sessions(id,bot_id,actor_id,revision,doc) VALUES(s->>'id',s->>'bot_id',s->>'actor_id',0,s);RETURN s;
 WHEN 'getEvent' THEN
   SELECT jsonb_build_object('fingerprint',fingerprint,'response',response,'input',input,'revision',revision) INTO out
    FROM public_bot_private.events WHERE session_id=payload->>'session' AND event_id=payload->>'event';RETURN out;
 WHEN 'history' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('revision',revision,'id',event_id,'input',input,'response',response) ORDER BY revision),'[]'::jsonb) INTO out
    FROM(SELECT * FROM public_bot_private.events WHERE session_id=payload->>'session' AND revision>(payload->>'after')::integer ORDER BY revision LIMIT 100) q;RETURN out;
 WHEN 'commit' THEN
   t:=payload->'turn';
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot:'||(t->>'bot_id'),0));
   SELECT doc INTO b FROM public_bot_private.bots WHERE id=t->>'bot_id';
   SELECT doc INTO s FROM public_bot_private.sessions WHERE id=t->>'session_id' FOR UPDATE;
   IF b IS NULL OR s IS NULL OR s->>'actor_id'<>t->>'actor_id' OR s->>'bot_id'<>t->>'bot_id' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF b->>'owner_id'<>t->>'actor_id' AND b->>'visibility'<>'public' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   SELECT jsonb_build_object('fingerprint',fingerprint,'response',response) INTO existing FROM public_bot_private.events WHERE session_id=t->>'session_id' AND event_id=t->>'event_id';
   IF existing IS NOT NULL THEN
    IF existing->>'fingerprint'<>t->>'fingerprint' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN existing->'response';
   END IF;
   IF b->>'status'<>'active' THEN RAISE EXCEPTION 'BOT_STOPPED'; END IF;
   IF (s->>'revision')::integer<>(t->>'expected_revision')::integer THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
   IF (s->>'revision')::integer>=10000 THEN RAISE EXCEPTION 'EVENT_LIMIT'; END IF;
   s:=s||jsonb_build_object('state',t->'state','revision',(s->>'revision')::integer+1,'updated_at',t->'timestamp');
   UPDATE public_bot_private.sessions SET revision=(s->>'revision')::integer,doc=s WHERE id=t->>'session_id';
   INSERT INTO public_bot_private.events VALUES(t->>'session_id',t->>'event_id',t->>'fingerprint',(s->>'revision')::integer,t->'response',t->'input');
   FOR item IN SELECT value FROM jsonb_array_elements(t->'records') LOOP
     INSERT INTO public_bot_private.records(id,bot_id,session_id,actor_id,event_id,item_index,doc)
      VALUES(item->>'id',t->>'bot_id',t->>'session_id',t->>'actor_id',t->>'event_id',(item->>'index')::integer,item);
   END LOOP;RETURN t->'response';
 WHEN 'records' THEN
   SELECT coalesce(jsonb_agg(doc||jsonb_build_object('seq',seq,'chat_id',session_id,'actor_id',actor_id,'event_id',event_id) ORDER BY seq),'[]'::jsonb) INTO out
    FROM(SELECT * FROM public_bot_private.records WHERE bot_id=payload->>'bot' AND seq>(payload->>'after')::bigint ORDER BY seq LIMIT 100) q;RETURN out;
 WHEN 'deleteSession' THEN DELETE FROM public_bot_private.sessions WHERE id=payload->>'id' AND actor_id=payload->>'actor';RETURN 'true'::jsonb;
 WHEN 'quota' THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quota:'||(payload->>'key'),0));
   DELETE FROM public_bot_private.quota_buckets WHERE reset_at<ms;
   SELECT count INTO n FROM public_bot_private.quota_buckets WHERE key=payload->>'key';
   IF n IS NOT NULL THEN
    IF n>=(payload->>'limit')::integer THEN RAISE EXCEPTION 'RATE_LIMIT'; END IF;
    UPDATE public_bot_private.quota_buckets SET count=count+1 WHERE key=payload->>'key';
   ELSE INSERT INTO public_bot_private.quota_buckets VALUES(payload->>'key',1,ms+(payload->>'seconds')::bigint*1000);END IF;RETURN 'true'::jsonb;
 WHEN 'createKey' THEN
   k:=payload->'key';PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('keys:'||(k->>'owner_id'),0));
   SELECT count(*) INTO n FROM public_bot_private.keys WHERE owner_id=k->>'owner_id' AND revoked_at IS NULL AND expires_at>ms;IF n>=100 THEN RAISE EXCEPTION 'KEY_LIMIT';END IF;
   INSERT INTO public_bot_private.keys VALUES(k->>'id',k->>'hash',k->>'owner_id',k->>'actor_id',k->>'scope',k->>'bot_id',k->>'label',(k->>'expires_at')::bigint,NULL,k->>'created_at');RETURN k;
 WHEN 'lookupKey' THEN
   SELECT jsonb_build_object('id',actor_id,'scope',scope,'bot_id',bot_id,'key_id',id,'owner_id',owner_id) INTO out
    FROM public_bot_private.keys k WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::text=k.owner_id AND p.is_approved=true) AND hash=payload->>'hash' AND revoked_at IS NULL AND expires_at>ms;RETURN out;
 WHEN 'listKeys' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'scope',scope,'bot_id',bot_id,'expires_at',expires_at,'revoked_at',revoked_at,'created_at',created_at) ORDER BY created_at DESC),'[]'::jsonb) INTO out
   FROM(SELECT * FROM public_bot_private.keys WHERE owner_id=payload->>'owner' ORDER BY created_at DESC LIMIT 100) q;RETURN out;
 WHEN 'revokeKey' THEN
   UPDATE public_bot_private.keys SET revoked_at=ms WHERE id=payload->>'id' AND owner_id=payload->>'owner';RETURN to_jsonb(FOUND);
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION';
 END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.public_bot_store_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_bot_store_v1(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
