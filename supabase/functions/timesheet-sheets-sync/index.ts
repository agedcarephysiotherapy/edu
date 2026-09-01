// Standalone HTTP wrapper around the shared Google Sheets append helper
// (../_shared/googleSheets.ts) — see that file for the full JWT-signing /
// OAuth2 service-account flow and its caveats (untested end-to-end, needs
// GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEETS_SPREADSHEET_ID secrets).
//
// The `timesheet` function's sign_out action does NOT call this function
// over HTTP — it imports appendTimesheetRow() directly from the shared
// module and calls it in-process (fire-and-forget), to avoid an extra
// network hop. This function exists as an independently invokable/testable
// endpoint doing the exact same append, useful for manually verifying the
// Google auth flow in isolation once real credentials are set.
//
// It writes to the exact same production spreadsheet as the real sign_out
// flow, so it's manager-gated the same way ask-assistant resolves role
// server-side from the caller's own JWT — never call appendTimesheetRow()
// here on the strength of anything the request body itself claims.
import { createClient } from "npm:@supabase/supabase-js@2";
import { appendTimesheetRow } from "../_shared/googleSheets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Body: { staffName, signedInAt, signedOutAt, rawHours, payableHours, inAddress, outAddress }
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

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role, status")
      .eq("id", userData.user.id)
      .single();
    if (profileErr || !profile || profile.status !== "approved" || profile.role !== "manager") {
      return json({ error: "Managers only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const rawHours = Number(body.rawHours) || 0;
    const payableHours = Number(body.payableHours) || 0;
    const row = [
      body.staffName ?? "",
      body.signedInAt ?? "",
      body.signedOutAt ?? "",
      rawHours,
      payableHours,
      Math.round((payableHours - rawHours) * 100) / 100,
      body.inAddress ?? "",
      body.outAddress ?? "",
    ];
    await appendTimesheetRow(row);
    return json({ success: true });
  } catch (err) {
    console.error("timesheet-sheets-sync failed:", err);
    // Non-blocking by design — return 200 with success:false rather than an
    // error status, matching how the in-process caller treats a Sheets
    // failure as log-only, never fatal.
    return json({ success: false, error: String(err) });
  }
});
