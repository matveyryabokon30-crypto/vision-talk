-- DISPOSABLE LOCAL/CI DATABASE ONLY. Minimal observed Supabase schema contract.
-- This file has no deployment path and is never run against the live project.
-- Roles are cluster-wide; the supplied-hash test uses a second clean database
-- on this same disposable cluster. It reuses the initial fixture's roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$$;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  phone text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  is_anonymous boolean DEFAULT false,
  banned_until timestamptz
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_id text NOT NULL,
  identity_data jsonb DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_id)
);
REVOKE ALL ON auth.users, auth.identities FROM PUBLIC, anon, authenticated;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  avatar_url text,
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (username, display_name, avatar_url) ON public.profiles TO authenticated;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR is_approved);
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id,username) VALUES (NEW.id, 'old_' || right(replace(NEW.id::text,'-',''),12));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO auth.users(id,email,banned_until) VALUES
  ('00000000-0000-4000-8000-000000000011','existing@example.invalid',NULL),
  ('00000000-0000-4000-8000-000000000012',NULL,NULL),
  ('00000000-0000-4000-8000-000000000013',NULL,now() + interval '1 day');
UPDATE public.profiles SET is_approved = true WHERE id = '00000000-0000-4000-8000-000000000011';
CREATE TABLE public.conversations (id uuid PRIMARY KEY);
CREATE TABLE public.conversation_members (
  conversation_id uuid REFERENCES public.conversations(id),
  user_id uuid REFERENCES auth.users(id),
  PRIMARY KEY (conversation_id,user_id)
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id),
  sender_id uuid REFERENCES auth.users(id),
  body text NOT NULL
);
CREATE FUNCTION public.is_member(cid uuid, uid uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members cm JOIN public.profiles p ON p.id = cm.user_id
    WHERE cm.conversation_id = cid AND cm.user_id = uid AND p.is_approved = true);
$$;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.conversations,public.conversation_members,public.messages TO authenticated;
GRANT INSERT ON public.messages TO authenticated;
CREATE POLICY conversation_member_read ON public.conversations FOR SELECT TO authenticated USING (public.is_member(id));
CREATE POLICY membership_read ON public.conversation_members FOR SELECT TO authenticated USING (public.is_member(conversation_id));
CREATE POLICY message_member_read ON public.messages FOR SELECT TO authenticated USING (public.is_member(conversation_id));
CREATE POLICY message_member_write ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND public.is_member(conversation_id));
INSERT INTO public.conversations(id) VALUES ('00000000-0000-4000-8000-000000000099');
INSERT INTO public.conversation_members VALUES
  ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000012');
INSERT INTO public.messages(conversation_id,sender_id,body) VALUES
  ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000011','private fixture message');
