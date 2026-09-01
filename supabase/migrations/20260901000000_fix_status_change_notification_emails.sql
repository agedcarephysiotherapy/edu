-- supabase/migrations/20260901000000_fix_status_change_notification_emails.sql
--
-- The `on_status_change_notify_user` / `on_pending_signup_notify_managers`
-- triggers on `profiles` (functions `notify_user_of_status_change` and
-- `notify_managers_of_pending_signup`) existed only in the live database —
-- they predate this migration and were never captured in a migration file,
-- so this is both a fix and the first time they're tracked in the repo.
--
-- Fixes:
--   1. `notify_user_of_status_change` fired on ANY `profiles` UPDATE and
--      only checked `new.status`, not whether it had actually changed —
--      so an unrelated edit to an already-approved staff member's row
--      (e.g. the manager inline full_name edit, a category change) would
--      silently re-send the "you're approved" email every time. Now
--      guarded on `new.status is distinct from old.status`.
--   2. Both functions linked to `https://edu.acponline.com.au`, a stale
--      domain — the site's actual CNAME is `hub.acponline.com.au`.
--   3. Neither used the shared timestamped-subject / Lexend-signature
--      formatting every other Resend-sending function in this project
--      follows (see `supabase/functions/_shared/emailTemplate.ts`) —
--      brought in line here (SQL has no access to that Deno module, so
--      the same formatting is reproduced inline).

create or replace function public.notify_user_of_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  api_key text;
  email_subject text;
  email_body_html text;
  ts_str text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  ts_str := to_char(now() at time zone 'Australia/Sydney', 'DD/MM/YY HH24:MI:SS');

  if new.status = 'approved' then
    email_subject := 'You''re approved — ' || ts_str;
    email_body_html :=
      '<p>Hi ' || coalesce(new.full_name, new.email) || ',</p>' ||
      '<p>Your access to the ACP Training Tracker has been approved. You can now sign in and see your courses.</p>' ||
      '<p><a href="https://hub.acponline.com.au">Open the Training Tracker</a></p>';
  elsif new.status = 'rejected' then
    email_subject := 'Access request update — ' || ts_str;
    email_body_html :=
      '<p>Hi ' || coalesce(new.full_name, new.email) || ',</p>' ||
      '<p>Your access request for the ACP Training Tracker was not approved. If you believe this is a mistake, please contact your administrator.</p>';
  else
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'ACP Training Tracker <notifications@acponline.com.au>',
      'to', new.email,
      'subject', email_subject,
      'html',
        '<div style="font-family:''Lexend'',Arial,sans-serif;font-size:10px;line-height:1.6;color:#1a1a1a;">' ||
        '<style>@import url(''https://fonts.googleapis.com/css2?family=Lexend&display=swap'');</style>' ||
        email_body_html ||
        '<p style="margin-top:24px;">Aged Care Physiotherapy<br>Staff HUB</p>' ||
        '</div>'
    )
  );

  return new;
end;
$function$;

create or replace function public.notify_managers_of_pending_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  api_key text;
  mgr record;
  display_name text;
  ts_str text;
  email_html text;
begin
  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key';

  if api_key is null then
    return new;
  end if;

  display_name := coalesce(new.full_name, new.email);
  ts_str := to_char(now() at time zone 'Australia/Sydney', 'DD/MM/YY HH24:MI:SS');
  email_html :=
    '<div style="font-family:''Lexend'',Arial,sans-serif;font-size:10px;line-height:1.6;color:#1a1a1a;">' ||
    '<style>@import url(''https://fonts.googleapis.com/css2?family=Lexend&display=swap'');</style>' ||
    '<p><strong>' || display_name || '</strong> (' || new.email || ') just signed in and is waiting for approval.</p>' ||
    '<p><a href="https://hub.acponline.com.au">Open the Training Tracker</a> and go to the Manage Staff tab to approve or reject.</p>' ||
    '<p style="margin-top:24px;">Aged Care Physiotherapy<br>Staff HUB</p>' ||
    '</div>';

  for mgr in
    select email from public.profiles where role = 'manager' and status = 'approved'
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'ACP Training Tracker <notifications@acponline.com.au>',
        'to', mgr.email,
        'subject', 'New sign-in waiting for approval — ' || ts_str,
        'html', email_html
      )
    );
  end loop;

  return new;
end;
$function$;
