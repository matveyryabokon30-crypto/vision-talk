# Pablicus: public account provisioning proposal

**Current direction, 2026-09-08:** owner cancelled SMS and requested Google, Yandex and other mail-account OAuth. The older SMS-specific setup/acceptance rows below are historical and are not deployment instructions for the current scope. Shared username/pending-activation work is still required. See `OAUTH_PROVIDERS.md` and the Yandex extension below.

**Status: NOT APPLIED.** This is a reviewable SQL proposal, not an executed migration or evidence that public signup/SMS works. The current Supabase connection permits read-only inspection. Applying it requires legitimate database write access, an independent review, and staging acceptance. Do not attempt to work around that access restriction. No provider has been selected or purchased; no SMS has been sent by this work.

Owner decision, 2026-09-08: allow public registration and a phone → SMS code flow without requiring a new Pablicus password. This supersedes the earlier closed-registration product rule. It does not make private conversations or attachments public.

## Observed live schema

Read-only metadata inspection of project `ctcoqgsztdtsazdiwcmd` on 2026-09-08 established:

| Object | Observed definition / behavior |
| --- | --- |
| `profiles.id` | UUID primary key; foreign key to `auth.users(id)` with `ON DELETE CASCADE`. |
| `profiles.username` | NOT NULL, unique; check `^[a-z0-9_]{3,24}$`. |
| `profiles.is_approved` | NOT NULL boolean, default `false`. |
| `auth.users` | Has `email`, `email_confirmed_at`, `phone_confirmed_at`, `is_anonymous`, and UUID `id`. |
| `on_auth_user_created` | `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`. |
| `handle_new_user()` | Security definer; lowercases/sanitizes username metadata or email prefix; inserts profile ID and username; conflicts handled only on ID. Does not set approval. |
| Confirmation/profile triggers | No other custom triggers were found on `auth.users` or `public.profiles` during inspection. |
| Profile client update privileges | `authenticated` can update `username`, `display_name`, `avatar_url`; cannot update `id`, `is_approved`, or `created_at`. |
| Profile RLS | Authenticated SELECT: own profile or approved profile. UPDATE: own ID in both `USING` and `WITH CHECK`. |
| `is_member(cid, uid)` | Requires a matching `conversation_members` row joined to a profile with `is_approved = true`. Default `uid` is `auth.uid()`. |
| Conversation/message RLS | SELECT is restricted through `is_member`; membership is not inferred from merely having an authenticated session. |
| Storage RLS | `message-media` objects require conversation membership; upload/delete also bind the path to the current user's ID. |
| Message/chat RPCs | `send_message`, `send_attachment_message`, `start_direct_conversation`, and conversation lists check approval and actual membership as appropriate. |

Three signup defects follow directly from this definition: a phone-only user without username metadata produces NULL instead of a username; a long email prefix can fail the 24-character constraint; and a duplicate username can abort account creation. Every successfully created profile is also unapproved. Changing only the HTML or removing its approval check does not resolve these server conditions.

The proposal retains `is_approved` as the server access switch and leaves every existing profile, conversation, and membership unchanged. A new `activation_pending` flag distinguishes only new accounts awaiting their first identity confirmation. Existing unapproved accounts are **not** treated as awaiting automatic activation.

## Preconditions and configuration

1. Obtain authorized write access to the existing project. Do not create a replacement backend or insert administrative credentials into the client. Convert this proposal into a normal versioned migration using the project's deployment tooling after staging review; this Markdown file is not a migration.
2. Review Auth settings before enabling public flows. Turn off email auto-confirm **before** offering public email signup or relying on email confirmation timestamps as proof of ownership. Keep anonymous signup disabled for this flow. Do not change current users' passwords or confirmation data.
3. Select an SMS delivery provider with the owner and configure its credentials, sender/service identity, permitted destinations, delivery limits, and budget in Supabase/server configuration. Credentials stay on the server, never in this public repository or browser JavaScript. No provider purchase or paid subscription is authorized by this document.
4. Enable phone authentication and real phone verification with production test-number overrides disabled. Configure server-side request limits and abuse protection for the chosen deployment. Client cooldowns are only interface behavior, not enforcement.
5. Public signup may create a pending Auth row before proof is supplied. That row must not confer application access. Enabling signup is separate from activating a profile.
6. Email-domain detection can choose an available federated identity provider automatically; it cannot validate arbitrary mailbox passwords. Any supported provider must authenticate on its own trusted page and return a verified identity. Pablicus must not collect mailbox passwords. A provider-specific adapter/configuration is a separate task; it is not implemented by this SQL.

Supabase documents phone OTP through `signInWithOtp` / `verifyOtp` and requires configuring SMS delivery: [Phone sign-in](https://supabase.com/docs/guides/auth/phone-login). Its user-management guide explains the Auth/profile trigger pattern and warns that a failing trigger can block signup: [User management](https://supabase.com/docs/guides/auth/managing-user-data). Trigger mechanics are covered in [Postgres triggers](https://supabase.com/docs/guides/database/postgres/triggers).

## Proposed SQL — NOT APPLIED

Run only in a reviewed staging migration first. The transaction deliberately does not contain an `UPDATE` backfill approving existing accounts. It retains the existing trigger name and all conversation/storage policies. It neither changes passwords nor exposes the Auth schema.

The private trigger functions use elevated database privileges solely for server-managed profile provisioning; they have no callable client API. The existing public `handle_new_user()` remains a trigger function with client execution revoked. Creation/replacement must use the same trusted database migration owner as the current trigger.

```sql
BEGIN;

-- Existing rows receive false and retain their current is_approved value.
-- Intentionally fail if this column already exists: inspect schema drift first.
ALTER TABLE public.profiles
  ADD COLUMN activation_pending boolean NOT NULL DEFAULT false;

CREATE SCHEMA IF NOT EXISTS pablicus_private;
REVOKE ALL ON SCHEMA pablicus_private FROM PUBLIC, anon, authenticated;

-- Preserve the observed client-editable profile fields only. A table-wide
-- UPDATE grant must not silently include the new activation flag.
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (is_approved, activation_pending)
  ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (username, display_name, avatar_url)
  ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  base_name text;
  candidate text;
  attempt integer;
  conflict_constraint text;
  is_verified boolean;
  is_pending boolean;
BEGIN
  -- These confirmation columns are maintained by Auth. User metadata is
  -- presentation input only; it never grants approval or other privileges.
  is_verified := NOT coalesce(NEW.is_anonymous, false)
    AND (NEW.email_confirmed_at IS NOT NULL
         OR NEW.phone_confirmed_at IS NOT NULL);
  is_pending := NOT coalesce(NEW.is_anonymous, false) AND NOT is_verified;

  base_name := left(
    regexp_replace(
      lower(coalesce(
        nullif(NEW.raw_user_meta_data ->> 'username', ''),
        split_part(coalesce(NEW.email, ''), '@', 1)
      )),
      '[^a-z0-9_]', '', 'g'
    ),
    24
  );
  IF coalesce(char_length(base_name), 0) < 3 THEN
    -- Valid for phone-only users; no email or extra signup field required.
    base_name := 'u_' || left(replace(NEW.id::text, '-', ''), 22);
  END IF;

  FOR attempt IN 0..7 LOOP
    candidate := CASE WHEN attempt = 0 THEN base_name ELSE
      left(base_name, 15) || '_' ||
      left(md5(NEW.id::text || ':' || attempt::text), 8)
    END;
    BEGIN
      INSERT INTO public.profiles
        (id, username, is_approved, activation_pending)
      VALUES
        (NEW.id, candidate, is_verified, is_pending)
      ON CONFLICT (id) DO NOTHING;
      -- An existing profile is never overwritten or reapproved here.
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS conflict_constraint = CONSTRAINT_NAME;
      IF conflict_constraint <> 'profiles_username_key' THEN
        RAISE;
      END IF;
      -- Retry only a username collision; do not hide unrelated failures.
    END;
  END LOOP;
  RAISE EXCEPTION 'could not allocate profile username';
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

-- Existing on_auth_user_created already invokes the replaced function.
-- No duplicate AFTER INSERT trigger is installed.

CREATE FUNCTION pablicus_private.consume_profile_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- Any explicit approval decision consumes eligibility, including an admin
  -- setting is_approved=false while an account is still awaiting its OTP.
  -- Only existing privileged roles may write is_approved.
  NEW.activation_pending := false;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION pablicus_private.consume_profile_activation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profile_approval_consumes_activation
BEFORE UPDATE OF is_approved ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION pablicus_private.consume_profile_activation();

CREATE FUNCTION pablicus_private.activate_confirmed_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  IF (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
     OR (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL)
  THEN
    UPDATE public.profiles
       SET is_approved = true,
           activation_pending = false
     WHERE id = NEW.id
       AND activation_pending = true
       AND is_approved = false;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION pablicus_private.activate_confirmed_profile()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER auth_confirmation_activates_pending_profile
AFTER UPDATE OF email_confirmed_at, phone_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION pablicus_private.activate_confirmed_profile();

-- Existing RLS policies, is_member(), message/chat RPCs, and media rules
-- continue to require actual membership and is_approved=true.
COMMIT;
```

`activation_pending` is not a general permission to reapprove users. It is consumed once. An administrator denying access by updating `is_approved=false` also consumes it, even when approval was already false. Later profile edits, logins, or identity changes therefore do not undo that decision. An Auth-level ban also remains an Auth-level restriction; this proposal does not modify `auth.users.banned_until`, sessions, or Auth administration behavior.

The username fallback uses a bounded collision retry. Exhausting the retries must fail signup visibly instead of creating an invalid/duplicate profile. A staging test should force that branch; it is not evidence of a production failure.

## Acceptance before publication

| Case | Required evidence |
| --- | --- |
| Real new phone, no email | Request an OTP to an authorized tester's real number; receive it; verify it; create one valid profile; obtain a session and enter the app without choosing a password. No artificial confirmation writes or production test-number bypasses. |
| Request without proof | A pending Auth/profile row may exist, but no approved profile or usable app session is granted by requesting a code alone. With no verified identity, conversation/message/media access fails. |
| Invalid, expired, or replayed OTP | No first-time activation or new session from invalid proof; error is understandable; resend follows server limits. |
| Existing accounts | IDs, usernames, approval decisions, conversations, message ordering, and memberships are unchanged. Existing approved users continue to sign in. |
| Existing unapproved account | Confirmation/sign-in cannot activate it because the new flag defaults to false on all historical rows. |
| Suspension after activation | Administrator sets `is_approved=false`; fresh requests under an existing token and subsequent sign-ins cannot read/send private chat data because server membership checks still require approval. Do not claim already downloaded files can be revoked. |
| Denial before first confirmation | Administrator explicitly sets pending profile approval to false; pending flag is consumed; entering the subsequent real OTP does not grant application access. |
| Auth ban | Existing banned identities remain banned under the platform's Auth behavior; no migration or frontend fallback clears a ban. |
| Username edge cases | Phone-only, empty metadata, long/invalid metadata, and duplicate prefixes create valid distinct usernames; unrelated database failures remain errors. |
| Client privilege escalation | `anon`/`authenticated` cannot set approval/pending status or call the private trigger functions. Existing own-profile presentation edits still work under RLS. |
| Three-account isolation | A and B can exchange a message in their dialog. C cannot select their conversation, members, messages, or files; cannot send to it or mark it read. Check database RPC/REST/storage behavior, not just hidden interface elements. |
| Identity linking | A phone login must not silently take over an existing email account. Any linking uses the platform's verified, authenticated linking flow. |
| Return to app | Session restoration works in a fresh page load and installed PWA without asking for another code while the session is valid. |
| Delivery and cost | Real SMS receipt verified in the supported destinations; server limits and billing arrangement recorded. Mocks alone do not establish delivery. |

The browser candidate must remain unpublished or clearly unavailable until server configuration and the migration pass these gates. A successful local/mocked OTP test verifies client behavior only; it does not mean the provider is connected, new profiles are activated on the live server, or real SMS delivery has been accepted.

## Yandex identity activation extension — NOT APPLIED

For the current subject-only Yandex route, there is deliberately no email or phone to confirm. The trusted proof is an Auth-created identity for the exact configured provider `custom:yandex`. Read-only schema inspection on 2026-09-08 confirmed `auth.identities.user_id uuid`, `provider text`, and `provider_id text`. The upstream Auth source was inspected; the hosted project version and insertion order still need staging acceptance.

Include the following only in the same reviewed staging migration after the base proposal, before publication. Do not independently paste it into production. It requires the base private schema, new `activation_pending` flag and its approval-consumption trigger. It is not a bypass for the current read-only database connection.

```sql
CREATE FUNCTION pablicus_private.activate_yandex_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.provider <> 'custom:yandex'
     OR nullif(NEW.provider_id, '') IS NULL THEN
    RETURN NEW;
  END IF;

  -- A provider-authenticated subject-only account. No user-editable claim,
  -- claimed email address, old blocked profile or phone account is trusted.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = NEW.user_id
      AND NOT coalesce(u.is_anonymous, false)
      AND coalesce(u.email, '') = ''
      AND coalesce(u.phone, '') = ''
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
     SET is_approved = true, activation_pending = false
   WHERE id = NEW.user_id
     AND activation_pending = true
     AND is_approved = false;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION pablicus_private.activate_yandex_identity()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER yandex_identity_activates_pending_profile
AFTER INSERT ON auth.identities
FOR EACH ROW
EXECUTE FUNCTION pablicus_private.activate_yandex_identity();
```

This extension intentionally trusts only the Yandex provider configured with our verified UserInfo adapter. Mail.ru is not added speculatively. Neither `identity_data` nor `raw_user_meta_data` grants approval. No existing rows are updated in a backfill. Repeated logins, relinking identities and server profile blocks must not reactivate `activation_pending=false`.

Staging must demonstrate a real new Yandex account entering without an email/password prompt from Pablicus; a second login preserving the same user ID; no automatic merge with an existing email account; no activation for another provider/anonymous user/admin-denied profile; and unchanged conversation/file isolation. Before deployment, review all Auth-identity triggers and verify client roles cannot insert/update `auth.identities`. Existing base email-confirmation tests remain necessary for Google/Microsoft where a verified email is returned.

## Deployment / rollback boundary

After staging acceptance, apply the reviewed migration through authorized deployment tooling, verify profile privileges and the existing policies, then enable the public client flow against that exact server configuration. Keep a recorded definition of the old trigger function for rollback. If rollout must stop, disable new public signup/phone entry first; preserve all accounts and conversations created during testing. Do not attempt to restore the closed model with a blanket update to approval or by deleting users. This document does not execute any of those actions.
