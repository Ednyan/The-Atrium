-- A picture of each atrium for the atrium browser's cards (lib/atriumPreview):
-- what was on screen when its owner or an admin last left it, as a small WebP
-- in the traces bucket. Written by them -- lobbies' update policy already
-- allows exactly the owner and admins -- and read with the rest of the row.
--
-- Safe to run more than once.

alter table public.lobbies add column if not exists preview_url text;
alter table public.lobbies add column if not exists preview_at timestamptz;

-- Each picture is a new file, <atrium id>/preview-<time>.webp: the bucket lets
-- anyone add one, and a new address is never served stale from the CDN (which
-- keeps a file an hour, whatever its query string). The one it replaces is
-- then removed -- by the atrium's owner or an admin, whoever uploaded it -- so
-- none is left behind. (An earlier version overwrote one file instead; its
-- policy compared the lobby's own `name` column, not the file's, and never
-- matched -- hence `objects.name` throughout.)
drop policy if exists "Atrium previews are removed by their uploader" on storage.objects;
drop policy if exists "Atrium previews are rewritten by their atrium's owner and admins" on storage.objects;
drop policy if exists "Atrium previews are removed by their atrium's owner and admins" on storage.objects;
create policy "Atrium previews are removed by their atrium's owner and admins" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'traces' and objects.name ~ '/preview(-[0-9]+)?\.webp$'
    and exists (
      select 1 from public.lobbies l
      where l.id::text = (storage.foldername(objects.name))[1]
        and ((select auth.uid()) = l.owner_user_id or (select auth.uid()) = any(l.admin_user_ids))
    )
  );
