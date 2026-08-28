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
