-- Deleting a compliance document's file should always remove its
-- compliance_submissions row too — a trigger on storage.objects is the
-- one place that catches every deletion path (the purge job below,
-- a future manager "delete" button, or someone deleting straight from
-- the Supabase Storage dashboard), so the file and its DB record can
-- never drift out of sync (a dangling row pointing at a file that no
-- longer exists).

create or replace function public.handle_compliance_doc_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id = 'compliance-docs' then
    delete from public.compliance_submissions
    where file_path = old.name;
  end if;
  return old;
end;
$$;

-- Trigger-only function, never meant to be called directly via RPC.
revoke execute on function public.handle_compliance_doc_deleted() from public, anon, authenticated;

drop trigger if exists on_compliance_doc_deleted on storage.objects;
create trigger on_compliance_doc_deleted
after delete on storage.objects
for each row execute function public.handle_compliance_doc_deleted();
