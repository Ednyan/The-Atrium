-- Make profile creation survive OAuth sign-ups.
--
-- The original handle_new_user() inserted a single hardcoded username and
-- swallowed every error (EXCEPTION WHEN others THEN RAISE LOG; RETURN new).
-- When that insert failed the signup still succeeded, so the user ended up
-- authenticated with no profile row -- and since every screen past login needs
-- one, they silently bounced back to the homepage with nothing to explain it.
-- That is exactly what a first Google sign-in produced.
--
-- Changes:
--   1. Prefer a real name from the provider (Google sends full_name/name) over
--      the opaque user_<id-prefix> fallback, sanitized to the username_format
--      constraint (letters, numbers, underscore) and clipped to its 20-char
--      limit.
--   2. Retry with a numeric suffix on collision, so two people called "gabriela"
--      don't leave the second without a profile.
--   3. Keep signup working even if all attempts fail (the app's username screen
--      creates the row instead), but log loudly rather than silently.
--
-- The client no longer depends on this trigger -- ChooseUsernameScreen creates
-- the profile when one is missing -- but a correct trigger means most users
-- never see that fallback path at all.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  raw_name text;
  base_name text;
  candidate text;
  suffix int := 0;
BEGIN
  -- Prefer an explicit username (email signup), then whatever the OAuth
  -- provider called them, then the email's local part.
  raw_name := COALESCE(
    new.raw_user_meta_data->>'username',
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

  -- Walk suffixes until one is free. Bounded so a pathological case can't spin.
  WHILE suffix < 50 LOOP
    BEGIN
      INSERT INTO public.profiles (id, username, email, display_name)
      VALUES (new.id, candidate, new.email, candidate);
      RETURN new;
    EXCEPTION
      WHEN unique_violation THEN
        suffix := suffix + 1;
        -- Trim the base so base+suffix still fits inside 20 characters.
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
