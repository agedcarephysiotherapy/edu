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
import { appendTimesheetRow } from "../_shared/googleSheets.ts";

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
    const body = await req.json().catch(() => ({}));
    const row = [
      body.staffName ?? "",
      body.signedInAt ?? "",
      body.signedOutAt ?? "",
      body.rawHours ?? "",
      body.payableHours ?? "",
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
