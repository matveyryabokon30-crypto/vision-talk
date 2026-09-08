-- LOCAL TEST ONLY: synthetic application and storage tables, no Auth user writes.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text UNIQUE NOT NULL,is_approved boolean NOT NULL DEFAULT false);
CREATE TABLE public.conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'direct' CHECK(type IN ('direct','group')),
 title text,created_by uuid NOT NULL REFERENCES public.profiles(id),last_seq bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.conversation_members (
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),joined_at timestamptz NOT NULL DEFAULT now(),
 last_read_seq bigint NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE public.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_message_id uuid NOT NULL,conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 server_seq bigint NOT NULL,sender_id uuid NOT NULL REFERENCES public.profiles(id),
 type text NOT NULL DEFAULT 'text' CONSTRAINT messages_type_check CHECK(type IN ('text','file','image','video','document')),
 body text,attachment_path text,created_at timestamptz NOT NULL DEFAULT now(),attachment_metadata jsonb,
 UNIQUE(conversation_id,server_seq),UNIQUE(sender_id,client_message_id)
);
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL,owner_id text,metadata jsonb,
 UNIQUE(bucket_id,name)
);
CREATE FUNCTION public.is_member(cid uuid,uid uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.conversation_members cm JOIN public.profiles p ON p.id=cm.user_id WHERE cm.conversation_id=cid AND cm.user_id=uid AND p.is_approved);
$$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles,public.conversations,public.conversation_members,public.messages TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid() OR is_approved);
CREATE POLICY conversations_read ON public.conversations FOR SELECT TO authenticated USING(public.is_member(id));
CREATE POLICY members_read ON public.conversation_members FOR SELECT TO authenticated USING(public.is_member(conversation_id));
CREATE POLICY messages_read ON public.messages FOR SELECT TO authenticated USING(public.is_member(conversation_id));
INSERT INTO public.profiles VALUES
 ('10000000-0000-4000-8000-000000000001','member_a',true),
 ('10000000-0000-4000-8000-000000000002','member_b',true),
 ('10000000-0000-4000-8000-000000000003','outsider',true),
 ('10000000-0000-4000-8000-000000000004','suspended',false);
INSERT INTO public.conversations(id,created_by) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001');
INSERT INTO public.conversation_members(conversation_id,user_id) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001');
