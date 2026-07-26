-- Track whether a username was actually picked by the person, rather than
-- derived for them.
--
-- The app previously inferred this by regex-matching the trigger's fallback
-- name (user_<id-prefix>). That broke as soon as handle_new_user started
-- preferring the provider's real name for OAuth sign-ups: the generated
-- username no longer looked generated, so the "choose a username" step was
-- skipped and Google users silently kept whatever Google called them.
--
-- An explicit flag can't drift like that, and doesn't misfire on someone whose
-- chosen name happens to resemble the fallback pattern.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_chosen boolean NOT NULL DEFAULT false;

-- Everyone who exists today signed up by email, which required typing a
-- username, so they have already chosen one and must not be re-prompted.
UPDATE public.profiles SET username_chosen = true WHERE username_chosen = false;

-- Rewritten to set the flag: true only when the signup itself supplied a
-- username (the email form puts it in raw_user_meta_data), false when the name
-- is derived here -- which is every OAuth sign-up, since providers give a
-- display name but nothing that works as a username.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  supplied_name text;
  raw_name text;
  base_name text;
  candidate text;
  suffix int := 0;
  was_chosen boolean;
BEGIN
  supplied_name := new.raw_user_meta_data->>'username';
  was_chosen := supplied_name IS NOT NULL;

  raw_name := COALESCE(
    supplied_name,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(COALESCE(new.email, ''), '@', 1)
  );

  -- Strip anything username_format rejects, then enforce username_length.
  base_name := regexp_replace(COALESCE(raw_name, ''), '[^a-zA-Z0-9_]', '', 'g');
  base_name := left(base_name, 20);

  IF char_length(base_name) < 3 THEN
    base_name := 'user_' || substring(new.id::text, 1, 8);
  END IF;

  candidate := base_name;

  WHILE suffix < 50 LOOP
    BEGIN
      INSERT INTO public.profiles (id, username, email, display_name, username_chosen)
      VALUES (new.id, candidate, new.email, candidate, was_chosen);
      RETURN new;
    EXCEPTION
      WHEN unique_violation THEN
        suffix := suffix + 1;
        candidate := left(base_name, 20 - char_length(suffix::text)) || suffix::text;
      WHEN others THEN
        RAISE LOG 'handle_new_user failed for %: %', new.id, SQLERRM;
        RETURN new;
    END;
  END LOOP;

  RAISE LOG 'handle_new_user exhausted username attempts for %', new.id;
  RETURN new;
END;
$$;
