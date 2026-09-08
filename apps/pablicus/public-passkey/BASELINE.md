# Pre-installation baseline

Observed on 2026-09-08 before public first-key installation. The live project had 2 Auth accounts and 2 approved profiles. Public Auth settings returned `disable_signup=false`. No new public signup provider was enabled in the frontend.

The following is a reference copy of the existing provisioning function, not an automatic rollback. A rollback must preserve new accounts/keys and disable the new entry path before changing provisioning.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  desired text;
begin

  desired := lower(
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    )
  );

  desired := regexp_replace(
    desired,
    '[^a-z0-9_]',
    '',
    'g'
  );

  if length(desired) < 3 then
    desired :=
      'user_' ||
      substr(
        replace(new.id::text, '-', ''),
        1,
        8
      );
  end if;

  insert into public.profiles (
    id,
    username
  )
  values (
    new.id,
    desired
  )
  on conflict (id) do nothing;

  return new;

end;
$function$
```

The security advisor baseline contains existing intentional authenticated RPC definer notices, two internal handoff tables with no client RLS policy, and disabled leaked-password protection. Review new findings after installation; this change does not claim to resolve unrelated baseline findings.

