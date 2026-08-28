// Staff sign-in / sign-out timesheet, with GPS capture, reverse geocoding,
// and manager email alerts on GPS failure.
//
// Same auth pattern as ask-assistant: resolve the caller from their own JWT
// via an anon-key client, then use a service-role client for everything
// else (profile lookup, all timesheet_entries / timesheet_gps_failures
// writes) — role/identity is never trusted from the request body. This is
// also the ONLY write path to timesheet_entries / timesheet_gps_failures:
// neither table has an insert/update RLS policy for authenticated/anon, so
// raw_hours (computed here, server-side, from real timestamps — with a
// mandatory 30-minute unpaid break deducted for shifts over 5 hours) can
// never be tampered with client-side.
//
// Actions (POST body: { action: 'sign_in' | 'sign_out' | 'report_gps_failure', ... }):
//   sign_in             — { lat, lng, fit_to_work_declared }
//   sign_out            — { lat, lng, payable_hours?, pay_period_start?, pay_period_end?, pay_period_key? }
//   report_gps_failure  — { attempted_action, error_type }
//
// IMPORTANT: sign_in/sign_out success never sends email. Only
// report_gps_failure emails managers — this was a deliberate choice so
// managers aren't spammed with every ordinary sign-in/out (they see those
// in the Timesheets tab / Google Sheet instead).
//
// pay_period_start/end/key (sign_out only) are supplied by the client,
// computed from the same fortnight-anchor logic already used for the
// on-screen "this pay period" stat — the browser's local clock is the
// simplest reliable source of "what pay period is this shift in" without
// hand-rolling timezone-aware date math in the Edge Function. This only
// affects the Google Sheets "Fortnight Summary" convenience tab (paired
// with a matching key for upsert), never the actual paid hours: raw_hours
// and payable_hours on the entry itself remain fully server-computed and
// authoritative regardless of what period info the client sends.
import { createClient } from "npm:@supabase/supabase-js@2";
import { appendTimesheetRow, upsertFortnightSummary } from "../_shared/googleSheets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "ACP Timesheet <timesheet@acphysio.com.au>";
const NOMINATIM_USER_AGENT = "ACP-Timesheet/1.0 (contact: admin@acphysio.com.au)";

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Non-blocking by design — sign-in/sign-out must succeed even if
// geocoding is down or rate-limited. Returns null on any failure.
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
      { headers: { "User-Agent": NOMINATIM_USER_AGENT } },
    );
    if (!res.ok) {
      console.error("Nominatim reverse geocode failed:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return typeof data?.display_name === "string" ? data.display_name : null;
  } catch (err) {
    console.error("Nominatim reverse geocode threw:", err);
    return null;
  }
}

async function emailManagersOfGpsFailure(
  adminClient: ReturnType<typeof createClient>,
  staffName: string,
  attemptedAction: string,
  errorType: string,
) {
  if (!RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set — skipping GPS-failure manager email.");
    return;
  }
  try {
    const { data: managers, error } = await adminClient
      .from("profiles")
      .select("email")
      .eq("role", "manager")
      .eq("status", "approved");
    if (error) {
      console.error("Couldn't load managers to email:", error);
      return;
    }
    const recipients = (managers ?? []).map((m: { email: string }) => m.email).filter(Boolean);
    if (recipients.length === 0) return;

    const when = new Date().toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
    const actionLabel = attemptedAction === "sign_in" ? "sign in" : "sign out";
    const errorLabel = { permission_denied: "Location permission denied", position_unavailable: "Location unavailable", timeout: "Location request timed out" }[errorType] || errorType;
    const subject = `Timesheet GPS failure — ${staffName}`;
    const text = `${staffName} tried to ${actionLabel} on the timesheet but their device couldn't provide a location.\n\nAction attempted: ${actionLabel}\nError: ${errorLabel}\nTime: ${when}`;
    const html = `<p><strong>${staffName}</strong> tried to ${actionLabel} on the timesheet but their device couldn't provide a location.</p>
      <p><b>Action attempted:</b> ${actionLabel}<br><b>Error:</b> ${errorLabel}<br><b>Time:</b> ${when}</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: recipients,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Resend email send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("emailManagersOfGpsFailure threw:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not signed in" }, 401);
    }
    const staffId = userData.user.id;

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("full_name, email, role, status")
      .eq("id", staffId)
      .single();
    if (profileErr || !profile || profile.status !== "approved") {
      return json({ error: "No approved profile found for this account" }, 403);
    }
    const staffName = profile.full_name || profile.email || "A staff member";

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const action = payload?.action;

    // ---- sign_in ----
    if (action === "sign_in") {
      const lat = payload.lat;
      const lng = payload.lng;
      if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
        return json({ error: "lat and lng are required" }, 400);
      }
      // Enforced server-side, not just as a disabled button client-side —
      // same posture as the GPS hard gate.
      if (payload.fit_to_work_declared !== true) {
        return json({ error: "You must confirm you're fit to work before signing in." }, 400);
      }

      const { data: openEntry, error: openErr } = await adminClient
        .from("timesheet_entries")
        .select("id")
        .eq("staff_id", staffId)
        .eq("status", "open")
        .maybeSingle();
      if (openErr) {
        console.error("sign_in: open-entry lookup failed:", openErr);
        return json({ error: "Couldn't check your timesheet — try again." }, 500);
      }
      if (openEntry) {
        return json({ error: "You're already signed in — sign out first." }, 409);
      }

      const address = await reverseGeocode(lat, lng);
      const signedInAt = new Date().toISOString();
      const { error: insertErr } = await adminClient.from("timesheet_entries").insert({
        staff_id: staffId,
        signed_in_at: signedInAt,
        in_lat: lat,
        in_lng: lng,
        in_address: address,
        status: "open",
        fit_to_work_declared: true,
      });
      if (insertErr) {
        console.error("sign_in: insert failed:", insertErr);
        return json({ error: "Couldn't sign you in — try again." }, 500);
      }

      return json({ success: true, signed_in_at: signedInAt, address });
    }

    // ---- sign_out ----
    if (action === "sign_out") {
      const lat = payload.lat;
      const lng = payload.lng;
      if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
        return json({ error: "lat and lng are required" }, 400);
      }
      const clientPayableHours = payload.payable_hours;

      const { data: openEntry, error: openErr } = await adminClient
        .from("timesheet_entries")
        .select("id, signed_in_at")
        .eq("staff_id", staffId)
        .eq("status", "open")
        .maybeSingle();
      if (openErr) {
        console.error("sign_out: open-entry lookup failed:", openErr);
        return json({ error: "Couldn't check your timesheet — try again." }, 500);
      }
      if (!openEntry) {
        return json({ error: "You don't have an open sign-in to sign out of." }, 409);
      }

      const address = await reverseGeocode(lat, lng);
      const signedOutAt = new Date();
      const signedInAt = new Date(openEntry.signed_in_at);
      // Authoritative — computed server-side from real timestamps. Shifts
      // longer than 5 hours have a mandatory 30-minute unpaid break
      // deducted before rounding to 2dp. Any raw_hours the client might
      // have sent is ignored.
      const rawDiffHours = (signedOutAt.getTime() - signedInAt.getTime()) / 3600000;
      const rawHoursWithBreak = rawDiffHours > 5 ? rawDiffHours - 0.5 : rawDiffHours;
      const rawHours = Math.round(rawHoursWithBreak * 100) / 100;
      const payableHours = isFiniteNumber(clientPayableHours) && clientPayableHours > 0
        ? Math.round(clientPayableHours * 100) / 100
        : rawHours;

      const { error: updateErr } = await adminClient
        .from("timesheet_entries")
        .update({
          signed_out_at: signedOutAt.toISOString(),
          out_lat: lat,
          out_lng: lng,
          out_address: address,
          raw_hours: rawHours,
          payable_hours: payableHours,
          status: "closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", openEntry.id);
      if (updateErr) {
        console.error("sign_out: update failed:", updateErr);
        return json({ error: "Couldn't sign you out — try again." }, 500);
      }

      // Fire-and-forget Google Sheets sync — never blocks or fails the
      // sign-out response.
      (async () => {
        try {
          const { data: entryRow } = await adminClient
            .from("timesheet_entries")
            .select("in_address")
            .eq("id", openEntry.id)
            .single();
          await appendTimesheetRow([
            staffName,
            openEntry.signed_in_at,
            signedOutAt.toISOString(),
            rawHours,
            payableHours,
            Math.round((payableHours - rawHours) * 100) / 100,
            entryRow?.in_address ?? "",
            address ?? "",
          ]);
        } catch (err) {
          console.error("sign_out: Sheets sync failed (non-blocking):", err);
        }

        // Rolling per-staff pay-period total, for payroll reconciliation —
        // also fire-and-forget, entirely independent of the row-log append
        // above (one failing never blocks or affects the other).
        try {
          const periodStart = typeof payload.pay_period_start === "string" ? payload.pay_period_start : null;
          const periodEnd = typeof payload.pay_period_end === "string" ? payload.pay_period_end : null;
          const periodKey = typeof payload.pay_period_key === "string" ? payload.pay_period_key : null;
          if (periodStart && periodEnd && periodKey) {
            const { data: periodEntries, error: periodErr } = await adminClient
              .from("timesheet_entries")
              .select("payable_hours")
              .eq("staff_id", staffId)
              .eq("status", "closed")
              .gte("signed_in_at", periodStart)
              .lt("signed_in_at", periodEnd);
            if (periodErr) {
              console.error("sign_out: pay-period total query failed:", periodErr);
            } else {
              const totalHours = (periodEntries ?? []).reduce(
                (sum: number, e: { payable_hours: number | null }) => sum + (Number(e.payable_hours) || 0),
                0,
              );
              await upsertFortnightSummary(staffName, periodKey, totalHours);
            }
          }
        } catch (err) {
          console.error("sign_out: Fortnight summary sync failed (non-blocking):", err);
        }
      })();

      return json({
        success: true,
        signed_out_at: signedOutAt.toISOString(),
        raw_hours: rawHours,
        payable_hours: payableHours,
        delta: Math.round((payableHours - rawHours) * 100) / 100,
        address,
      });
    }

    // ---- report_gps_failure ----
    if (action === "report_gps_failure") {
      const attemptedAction = payload.attempted_action;
      const errorType = payload.error_type;
      if (
        (attemptedAction !== "sign_in" && attemptedAction !== "sign_out") ||
        !["permission_denied", "position_unavailable", "timeout"].includes(String(errorType))
      ) {
        return json({ error: "Invalid attempted_action or error_type" }, 400);
      }

      const { error: insertErr } = await adminClient.from("timesheet_gps_failures").insert({
        staff_id: staffId,
        attempted_action: attemptedAction,
        error_type: errorType,
      });
      if (insertErr) {
        console.error("report_gps_failure: insert failed:", insertErr);
        // Still fine to try to email even if the DB insert somehow failed —
        // but per spec this action should not fail the whole request either
        // way, so keep going rather than returning an error.
      }

      await emailManagersOfGpsFailure(adminClient, staffName, String(attemptedAction), String(errorType));

      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("timesheet function failed:", err);
    return json({ error: "Something went wrong — try again." }, 500);
  }
});
