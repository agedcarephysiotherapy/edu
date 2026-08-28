-- Lets a manager record a compliance document as already-satisfied directly
-- (e.g. they hold the physical original, or are backfilling historical
-- records), pre-approved, without the staff-upload-then-review round trip.
-- The existing "staff can submit against own requirements" INSERT policy on
-- compliance_submissions only allows a submission whose requirement belongs
-- to the caller — a manager entering it on someone else's behalf needs a
-- policy of its own.
create policy "managers can record compliance submissions"
  on public.compliance_submissions for insert
  to authenticated
  with check (is_manager());

-- Same gap on the storage side: "staff can upload own compliance docs" only
-- allows a path whose first folder segment is the uploader's own auth.uid().
-- A manager uploading a scan on behalf of another staff member needs to
-- write under that staff member's folder instead.
create policy "managers can upload compliance docs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'compliance-docs' and is_manager());
