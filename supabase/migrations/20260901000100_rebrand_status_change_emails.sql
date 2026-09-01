-- supabase/migrations/20260901000100_rebrand_status_change_emails.sql
--
-- The previous migration (20260901000000) fixed the domain/formatting on
-- notify_user_of_status_change / notify_managers_of_pending_signup but
-- left the old "ACP Training Tracker" product name in the from-name, body
-- copy, and link text. The app is branded "ACP Staff Hub" everywhere in
-- index.html (title, auth heading, dashboard heading) and in every other
-- Resend-sending function's copy — "Training Tracker" is stale naming.
-- Renaming it here to match.

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
      '<p>Your access to the ACP Staff Hub has been approved. You can now sign in and see your courses.</p>' ||
      '<p><a href="https://hub.acponline.com.au">Open the Staff Hub</a></p>';
  elsif new.status = 'rejected' then
    email_subject := 'Access request update — ' || ts_str;
    email_body_html :=
      '<p>Hi ' || coalesce(new.full_name, new.email) || ',</p>' ||
      '<p>Your access request for the ACP Staff Hub was not approved. If you believe this is a mistake, please contact your administrator.</p>';
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
      'from', 'ACP Staff Hub <notifications@acponline.com.au>',
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
    '<p><a href="https://hub.acponline.com.au">Open the Staff Hub</a> and go to the Manage Staff tab to approve or reject.</p>' ||
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
        'from', 'ACP Staff Hub <notifications@acponline.com.au>',
        'to', mgr.email,
        'subject', 'New sign-in waiting for approval — ' || ts_str,
        'html', email_html
      )
    );
  end loop;

  return new;
end;
$function$;
