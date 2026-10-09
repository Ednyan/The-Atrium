-- Spooky's picture: pumpkins and candles at night, over the whole view,
-- faint, drifting with it (public/themes/spooky.webp, a public domain photo
-- carried by the app). For a database where add_special_themes.sql ran
-- before the picture was part of Spooky. Its other settings are left as they
-- are.
--
-- Safe to run twice.

update public.special_themes
set theme_settings = theme_settings || '{
      "backgroundImage": "/themes/spooky.webp",
      "backgroundImageEnabled": true,
      "backgroundImageFill": true,
      "backgroundImageOpacity": 0.35,
      "backgroundImageScale": 1,
      "backgroundParallaxEnabled": true,
      "backgroundParallax": 0.5
    }'::jsonb,
    updated_at = now()
where id = '5b0c7a1e-0000-4000-8000-000000000031';
