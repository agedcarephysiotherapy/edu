-- Runs the timesheet-auto-signout Edge Function every 15 minutes via
-- pg_net. The function is deployed with verify_jwt=false (see its own doc
-- comment for why), so no Authorization header is needed here — it's safe
-- to call unauthenticated since it's idempotent and only ever acts on
-- entries already provably 9+ hours overdue by wall-clock time.
select cron.schedule(
  'timesheet_auto_signout',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://unomkggpwiugvkovdjto.supabase.co/functions/v1/timesheet-auto-signout',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
