-- X Writer: allow a 'pending' placeholder row used to reserve a daily batch slot
-- before the model call. Pending rows are never listed in either tab.
alter table public.x_drafts drop constraint if exists x_drafts_status_check;
alter table public.x_drafts add constraint x_drafts_status_check
  check (status is null or status in ('pending', 'draft', 'completed', 'archived')) not valid;
