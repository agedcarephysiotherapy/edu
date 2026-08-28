-- compliance_submissions.file_path was NOT NULL, which worked fine for the
-- staff self-upload flow (a file is always attached there) but not for the
-- new manager "Record a Compliance Document" path, where the brief
-- explicitly calls out the case of a manager holding the physical original
-- with no scan to attach — mirroring how completions.certificate_path is
-- already nullable for the equivalent "Record a Completion" flow.
alter table public.compliance_submissions
  alter column file_path drop not null;
