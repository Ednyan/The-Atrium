-- The width/height DEFAULT 200 added in add_shape_support.sql was meant only
-- for shape traces (the app already sets both explicitly at creation time
-- for shapes), but Postgres column defaults apply to every insert that
-- omits the column, not just one trace type. Every other trace type
-- (image/embed/text/audio/video) silently got a baked-in 200x200 on
-- insert, which permanently overrides aspect-ratio detection in the client
-- (getTraceSize checks trace.width/height before imageDimensions), so
-- embeds and images rendered as a fixed square instead of their real
-- proportions. SQLite (desktop) never had this default, which is why the
-- bug only showed up on web.
ALTER TABLE traces ALTER COLUMN width DROP DEFAULT;
ALTER TABLE traces ALTER COLUMN height DROP DEFAULT;

-- Repair existing non-shape traces sitting at exactly the buggy default
-- combination so aspect-ratio detection can take over next time they load.
-- Scoped narrowly (non-shape AND exactly 200x200) to avoid touching a
-- genuine user resize that happened to land on the same values.
UPDATE traces
SET width = NULL, height = NULL
WHERE type <> 'shape' AND width = 200 AND height = 200;
