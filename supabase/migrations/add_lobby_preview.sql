-- A picture of each atrium for the atrium browser's cards (lib/atriumPreview):
-- what was on screen when its owner or an admin last left it, as a small WebP
-- in the traces bucket. Written by them -- lobbies' update policy already
-- allows exactly the owner and admins -- and read with the rest of the row.
--
-- Safe to run more than once.

alter table public.lobbies add column if not exists preview_url text;
alter table public.lobbies add column if not exists preview_at timestamptz;

-- One file an atrium, <atrium id>/preview.webp, rewritten each time -- so no
-- old picture is ever left behind. The bucket lets anyone add a file but
-- nobody overwrite one; this one may be overwritten by the atrium's owner and
-- admins, whoever first wrote it.
drop policy if exists "Atrium previews are removed by their uploader" on storage.objects;
drop policy if exists "Atrium previews are rewritten by their atrium's owner and admins" on storage.objects;
create policy "Atrium previews are rewritten by their atrium's owner and admins" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'traces' and name like '%/preview.webp'
    and exists (
      select 1 from public.lobbies l
      where l.id::text = (storage.foldername(name))[1]
        and ((select auth.uid()) = l.owner_user_id or (select auth.uid()) = any(l.admin_user_ids))
    )
  )
  with check (
    bucket_id = 'traces' and name like '%/preview.webp'
    and exists (
      select 1 from public.lobbies l
      where l.id::text = (storage.foldername(name))[1]
        and ((select auth.uid()) = l.owner_user_id or (select auth.uid()) = any(l.admin_user_ids))
    )
  );
