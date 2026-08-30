// Safety-net sweep: closes any timesheet_entries row that's been left
// "open" (signed in, never signed out) for 9+ hours — a staff member who
// forgot to sign out, or whose device died/lost connectivity before they
// could. Without this, that row stays open forever and blocks the staff
// member's next sign-in (the `timesheet` function's sign_in action refuses
// a second open entry).
//
// Triggered on a schedule by pg_cron + pg_net (see the
// `schedule_timesheet_auto_signout` migration) — NOT meant to be called by
// end users. It authenticates the same way any Edge Function does (a valid
// Supabase-signed JWT is required — verify_jwt stays on, and the cron job
// passes the project's anon key, which is already public, as the bearer
// token; this function only ever acts via its own service-role client
// regardless of who/what calls it, same as `timesheet`). It's also safe to
// invoke repeatedly/concurrently: after the first sweep closes everything
// past the 9h cutoff, there's nothing left to act on until more time
// passes, so accidental re-runs are harmless no-ops.
//
// What happens to a swept entry:
//   - signed_out_at is set to exactly signed_in_at + 9 hours (not "now" —
//     so the recorded hours reflect the 9h cutoff precisely, independent
//     of how much cron-polling lag there was).
//   - raw_hours/payable_hours use the same mandatory-30-minute-break rule
//     as a normal sign-out (9h > 5h, so raw_hours = 8.5).
//   - out_lat/out_lng/out_address are left null — there was no client
//     action to capture a location from, which is expected and NOT an
//     error condition; the UI should render this distinctly from a normal
//     entry rather than looking like missing/broken data.
//   - auto_signed_out is set true, so both the DB and the UI can
//     distinguish this from a real sign-out.
//   - Both the staff member and all approved managers are emailed.
//   - The row still gets appended to the Google Sheets log (Sheet1) same
//     as any closed entry. It deliberately does NOT touch the "Fortnight
//     Summary" tab here — that upsert needs pay-period boundaries, which
//     the normal flow gets from the client's local clock (see timesheet/
//     index.ts's doc comment on why). Rather than duplicate timezone-aware
//     period math server-side for this rare path, the Fortnight Summary
//     simply catches up automatically the next time that staff member does
//     a real sign-out in the same pay period (its upsert re-sums ALL
//     closed entries in the period from the DB, auto-closed ones
//     included). If they don't sign in again before the period ends, that
//     period's summary row just won't include this shift until someone
//     looks — acceptable for a rare safety-net path, and still fully
//     correct in the source-of-truth database and the Timesheets tab.
import { createClient } from "npm:@supabase/supabase-js@2";
import { appendTimesheetRow } from "../_shared/googleSheets.ts";
import { withTimestamp, wrapHtml, wrapText } from "../_shared/emailTemplate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "ACP Timesheet <timesheet@acphysio.com.au>";
const AUTO_SIGNOUT_HOURS = 9;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function sendEmail(to: string[], subject: string, text: string, html: string) {
  if (!RESEND_API_KEY || to.length === 0) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, text, html }),
    });
    if (!res.ok) {
      console.error("Resend email send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendEmail threw:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cutoffIso = new Date(Date.now() - AUTO_SIGNOUT_HOURS * 3600000).toISOString();

    const { data: overdueEntries, error: findErr } = await adminClient
      .from("timesheet_entries")
      .select("id, staff_id, signed_in_at")
      .eq("status", "open")
      .lte("signed_in_at", cutoffIso);
    if (findErr) {
      console.error("timesheet-auto-signout: lookup failed:", findErr);
      return json({ error: "Lookup failed" }, 500);
    }
    if (!overdueEntries || overdueEntries.length === 0) {
      return json({ success: true, closed: 0 });
    }

    const { data: managers } = await adminClient
      .from("profiles")
      .select("email")
      .eq("role", "manager")
      .eq("status", "approved");
    const managerEmails = (managers ?? []).map((m: { email: string }) => m.email).filter(Boolean);

    let closed = 0;
    for (const entry of overdueEntries) {
      const signedInAt = new Date(entry.signed_in_at);
      const signedOutAt = new Date(signedInAt.getTime() + AUTO_SIGNOUT_HOURS * 3600000);
      const rawDiffHours = AUTO_SIGNOUT_HOURS;
      const rawHours = Math.round((rawDiffHours > 5 ? rawDiffHours - 0.5 : rawDiffHours) * 100) / 100;
      const payableHours = rawHours;

      const { error: updateErr } = await adminClient
        .from("timesheet_entries")
        .update({
          signed_out_at: signedOutAt.toISOString(),
          out_lat: null,
          out_lng: null,
          out_address: null,
          raw_hours: rawHours,
          payable_hours: payableHours,
          status: "closed",
          auto_signed_out: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id)
        .eq("status", "open"); // guard against a real sign-out racing this sweep
      if (updateErr) {
        console.error(`timesheet-auto-signout: update failed for entry ${entry.id}:`, updateErr);
        continue;
      }
      closed++;

      const { data: profile } = await adminClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", entry.staff_id)
        .single();
      const staffName = profile?.full_name || profile?.email || "A staff member";
      const staffEmail = profile?.email;
      const whenIn = signedInAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
      const whenOut = signedOutAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

      if (staffEmail) {
        await sendEmail(
          [staffEmail],
          withTimestamp("You were automatically signed out — please remember to sign out"),
          wrapText(
            `Hi ${staffName},\n\nYou signed in at ${whenIn} and hadn't signed out after ${AUTO_SIGNOUT_HOURS} hours, so the system automatically signed you out at ${whenOut} to keep your timesheet accurate.\n\n` +
              `Recorded hours: ${rawHours}h (mandatory 30-minute unpaid break already deducted). No location was recorded for this sign-out since it wasn't done from your device.\n\n` +
              `Please remember to sign out at the end of each shift. If ${rawHours}h doesn't reflect your actual hours worked, contact your manager to have it corrected.`,
          ),
          wrapHtml(
            `<p>Hi ${staffName},</p>` +
              `<p>You signed in at <b>${whenIn}</b> and hadn't signed out after ${AUTO_SIGNOUT_HOURS} hours, so the system automatically signed you out at <b>${whenOut}</b> to keep your timesheet accurate.</p>` +
              `<p><b>Recorded hours:</b> ${rawHours}h (mandatory 30-minute unpaid break already deducted). No location was recorded for this sign-out since it wasn't done from your device.</p>` +
              `<p>Please remember to sign out at the end of each shift. If ${rawHours}h doesn't reflect your actual hours worked, contact your manager to have it corrected.</p>`,
          ),
        );
      }
      if (managerEmails.length > 0) {
        await sendEmail(
          managerEmails,
          withTimestamp(`Auto sign-out — ${staffName}`),
          wrapText(
            `${staffName} signed in at ${whenIn} and was automatically signed out at ${whenOut} after ${AUTO_SIGNOUT_HOURS} hours without signing out themselves.\n\n` +
              `Recorded hours: ${rawHours}h (mandatory break deducted). No location was recorded for this sign-out. Staff member has also been notified by email.`,
          ),
          wrapHtml(
            `<p><b>${staffName}</b> signed in at ${whenIn} and was automatically signed out at <b>${whenOut}</b> after ${AUTO_SIGNOUT_HOURS} hours without signing out themselves.</p>` +
              `<p><b>Recorded hours:</b> ${rawHours}h (mandatory break deducted). No location was recorded for this sign-out. The staff member has also been notified by email.</p>`,
          ),
        );
      }

      try {
        await appendTimesheetRow([
          staffName,
          entry.signed_in_at,
          signedOutAt.toISOString(),
          rawHours,
          payableHours,
          0,
          "",
          "(auto sign-out — no location)",
        ]);
      } catch (err) {
        console.error(`timesheet-auto-signout: Sheets sync failed for entry ${entry.id} (non-blocking):`, err);
      }
    }

    return json({ success: true, closed });
  } catch (err) {
    console.error("timesheet-auto-signout failed:", err);
    return json({ error: "Something went wrong" }, 500);
  }
});
