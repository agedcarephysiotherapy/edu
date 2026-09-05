// Safety-net sweep: closes any timesheet entry left open for 9+ hours.
// The 8-hour reminder is a user prompt; this 9-hour server sweep remains the
// final safety net when a device/browser is unavailable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { upsertTimesheetRow } from "../_shared/googleSheets.ts";
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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function sendEmail(to: string[], subject: string, text: string, html: string) {
  if (!RESEND_API_KEY || to.length === 0) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, text, html }),
    });
    if (!res.ok) console.error("Resend email send failed:", res.status, await res.text());
  } catch (err) {
    console.error("sendEmail threw:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

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
    if (!overdueEntries || overdueEntries.length === 0) return json({ success: true, closed: 0 });

    const { data: managers } = await adminClient.from("profiles").select("email").eq("role", "manager").eq("status", "approved");
    const managerEmails = (managers ?? []).map((m: { email: string }) => m.email).filter(Boolean);
    let closed = 0;

    for (const entry of overdueEntries) {
      const signedInAt = new Date(entry.signed_in_at);
      const signedOutAt = new Date(signedInAt.getTime() + AUTO_SIGNOUT_HOURS * 3600000);
      const rawHours = 8.5;
      const payableHours = rawHours;

      const { data: updated, error: updateErr } = await adminClient
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
        .eq("status", "open")
        .select("id");
      if (updateErr) {
        console.error(`timesheet-auto-signout: update failed for entry ${entry.id}:`, updateErr);
        continue;
      }
      if (!updated || updated.length === 0) continue;
      closed++;

      const { data: profile } = await adminClient.from("profiles").select("full_name, email").eq("id", entry.staff_id).single();
      const staffName = profile?.full_name || profile?.email || "A staff member";
      const staffEmail = profile?.email;
      const whenIn = signedInAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
      const whenOut = signedOutAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

      if (staffEmail) {
        await sendEmail(
          [staffEmail],
          withTimestamp("You were automatically signed out — please remember to sign out"),
          wrapText(`Hi ${staffName},\n\nYou signed in at ${whenIn} and hadn't signed out after ${AUTO_SIGNOUT_HOURS} hours, so the system automatically signed you out at ${whenOut}.\n\nRecorded hours: ${rawHours}h (mandatory 30-minute unpaid break deducted). No location was recorded for this automatic sign-out.\n\nPlease remember to sign out at the end of each shift. If ${rawHours}h doesn't reflect your actual hours worked, contact your manager to have it corrected.`),
          wrapHtml(`<p>Hi ${staffName},</p><p>You signed in at <b>${whenIn}</b> and hadn't signed out after ${AUTO_SIGNOUT_HOURS} hours, so the system automatically signed you out at <b>${whenOut}</b>.</p><p><b>Recorded hours:</b> ${rawHours}h (mandatory 30-minute unpaid break deducted). No location was recorded for this automatic sign-out.</p><p>Please remember to sign out at the end of each shift. If ${rawHours}h doesn't reflect your actual hours worked, contact your manager to have it corrected.</p>`),
        );
      }

      if (managerEmails.length > 0) {
        await sendEmail(
          managerEmails,
          withTimestamp(`Auto sign-out — ${staffName}`),
          wrapText(`${staffName} signed in at ${whenIn} and was automatically signed out at ${whenOut} after ${AUTO_SIGNOUT_HOURS} hours without signing out themselves.\n\nRecorded hours: ${rawHours}h. The staff member has also been notified by email.`),
          wrapHtml(`<p><b>${staffName}</b> signed in at ${whenIn} and was automatically signed out at <b>${whenOut}</b> after ${AUTO_SIGNOUT_HOURS} hours without signing out themselves.</p><p><b>Recorded hours:</b> ${rawHours}h. The staff member has also been notified by email.</p>`),
        );
      }

      // Complete the same live Sheet1 row created at sign-in. This is
      // idempotent because the Supabase entry ID is the row key.
      try {
        await upsertTimesheetRow(entry.id, [
          staffName,
          entry.signed_in_at,
          signedOutAt.toISOString(),
          rawHours,
          payableHours,
          0,
          "",
          "(auto sign-out — no location)",
          "auto_signed_out",
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
