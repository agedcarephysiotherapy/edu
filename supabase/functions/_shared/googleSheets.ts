// Shared Google Sheets append helper, used by both:
//   - supabase/functions/timesheet/index.ts (calls this in-process from the
//     sign_out action, fire-and-forget, to avoid an extra network hop)
//   - supabase/functions/timesheet-sheets-sync/index.ts (a standalone Edge
//     Function wrapping the same logic behind its own HTTP endpoint, for
//     manual testing / as an independently invokable sync path)
//
// Auth: a Google service-account JWT bearer flow implemented by hand with
// Deno's built-in Web Crypto SubtleCrypto (RS256 signing) — deliberately no
// npm:googleapis dependency, which is heavy for an Edge Function. This is
// the standard OAuth2 "service account" server-to-server flow:
//   1. Build a JWT claim set (iss=service account email, scope, aud, exp/iat)
//   2. Sign it with the service account's RSA private key (RS256)
//   3. Exchange that signed JWT for a short-lived access token at
//      https://oauth2.googleapis.com/token
//   4. Use the access token as a normal Bearer token against the Sheets API
//
// NOTE: this has NOT been verified end-to-end against a real Google Cloud
// service account (none was available in the environment this was built
// in) — the flow follows Google's documented spec precisely, but treat it
// as best-effort/untested until it's exercised against a real
// GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEETS_SPREADSHEET_ID.
//
// Required secrets (Project Settings > Edge Functions > Secrets):
//   GOOGLE_SERVICE_ACCOUNT_JSON  — the full service account JSON key, stringified
//   GOOGLE_SHEETS_SPREADSHEET_ID — the target spreadsheet's ID (from its URL)
// Until both are set, appendTimesheetRow() no-ops (logs and returns)
// rather than throwing — this is a secondary/non-blocking path by design.

// ---- base64url helpers ----
function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

// PEM ("-----BEGIN PRIVATE KEY-----...") -> raw DER bytes for importKey.
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: nowSec + 3600,
    iat: nowSec,
  };
  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenData = await tokenRes.json();
  return tokenData.access_token as string;
}

// row = [staff name, signed_in_at, signed_out_at, raw_hours, payable_hours, delta, in_address, out_address]
export async function appendTimesheetRow(row: (string | number)[]): Promise<void> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!serviceAccountJson || !spreadsheetId) {
    console.log("Google Sheets sync: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping sheet append.");
    return;
  }
  const accessToken = await getGoogleAccessToken(serviceAccountJson);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) {
    throw new Error(`Sheets append failed: ${res.status} ${await res.text()}`);
  }
}

const FORTNIGHT_SHEET_TITLE = "Fortnight Summary";
const FORTNIGHT_SHEET_HEADER = ["Staff Name", "Pay Period", "Hours Worked", "Last Updated"];

// Creates the "Fortnight Summary" tab (with header row) if the spreadsheet
// doesn't already have one — self-healing so this doesn't need a manual
// setup step in the target spreadsheet before it starts working.
async function ensureFortnightSheet(accessToken: string, spreadsheetId: string): Promise<void> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) {
    throw new Error(`Sheets metadata fetch failed: ${metaRes.status} ${await metaRes.text()}`);
  }
  const meta = await metaRes.json();
  const exists = (meta.sheets ?? []).some(
    (s: { properties?: { title?: string } }) => s.properties?.title === FORTNIGHT_SHEET_TITLE,
  );
  if (exists) return;

  const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: FORTNIGHT_SHEET_TITLE } } }] }),
  });
  if (!addRes.ok) {
    throw new Error(`Adding "${FORTNIGHT_SHEET_TITLE}" tab failed: ${addRes.status} ${await addRes.text()}`);
  }

  const headerRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A1:D1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [FORTNIGHT_SHEET_HEADER] }),
    },
  );
  if (!headerRes.ok) {
    throw new Error(`Writing "${FORTNIGHT_SHEET_TITLE}" header failed: ${headerRes.status} ${await headerRes.text()}`);
  }
}

// Rolling per-staff, per-pay-period total for payroll reconciliation — one
// row per (staff, pay period), overwritten in place as more shifts are
// logged within that period, so the tab always shows current totals rather
// than growing a new row per sign-out (that detailed log lives in Sheet1,
// via appendTimesheetRow). periodLabel is both the display value and the
// match key, so it must be generated the same way every time for a given
// period (e.g. "2026-08-17 to 2026-08-30") — the caller owns that format.
export async function upsertFortnightSummary(
  staffName: string,
  periodLabel: string,
  totalHours: number,
): Promise<void> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!serviceAccountJson || !spreadsheetId) {
    console.log("Google Sheets sync: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping fortnight summary update.");
    return;
  }
  const accessToken = await getGoogleAccessToken(serviceAccountJson);
  await ensureFortnightSheet(accessToken, spreadsheetId);

  const range = `${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A2:B`;
  const getRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!getRes.ok) {
    throw new Error(`Fortnight summary read failed: ${getRes.status} ${await getRes.text()}`);
  }
  const getData = await getRes.json();
  const rows: string[][] = getData.values ?? [];
  // Row 1 is the header, so data starts at sheet row 2.
  const matchIdx = rows.findIndex((r) => r[0] === staffName && r[1] === periodLabel);
  const rowValues = [staffName, periodLabel, Math.round(totalHours * 100) / 100, new Date().toISOString()];

  if (matchIdx === -1) {
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [rowValues] }),
      },
    );
    if (!appendRes.ok) {
      throw new Error(`Fortnight summary append failed: ${appendRes.status} ${await appendRes.text()}`);
    }
    return;
  }

  const sheetRow = matchIdx + 2; // +1 for header, +1 for 1-based rows
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A${sheetRow}:D${sheetRow}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowValues] }),
    },
  );
  if (!updateRes.ok) {
    throw new Error(`Fortnight summary update failed: ${updateRes.status} ${await updateRes.text()}`);
  }
}
