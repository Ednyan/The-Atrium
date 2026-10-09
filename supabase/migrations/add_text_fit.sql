-- A text trace's text fitted to its box (text_fit: as large as the box
-- allows, the way Miro sizes text; new text traces are), and where it sits in
-- the box up and down (text_valign: top, middle or bottom; unset is the
-- middle). Both unset on every trace there is, which keep their own font size.
--
-- Run this BEFORE the web build that sends them deploys: new text traces are
-- saved with text_fit, and a table without the column refuses the save.
--
-- Safe to run twice.

alter table public.traces add column if not exists text_fit boolean;
alter table public.traces add column if not exists text_valign text;

alter table public.traces drop constraint if exists traces_text_valign_check;
alter table public.traces add constraint traces_text_valign_check
  check (text_valign is null or text_valign in ('top', 'middle', 'bottom'));
