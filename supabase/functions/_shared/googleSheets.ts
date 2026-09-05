// Shared Google Sheets helper for the ACP Staff Hub timesheet.
//
// Detailed timesheet log is stored in Sheet1. New rows are keyed by the
// Supabase timesheet entry ID so a row can be created immediately at sign-in
// and completed in place at sign-out. This prevents the old behaviour where
// Sheet1 only received a row after sign-out.

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
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
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();
  return tokenData.access_token as string;
}

async function getSheetAccess(): Promise<{ accessToken: string; spreadsheetId: string } | null> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!serviceAccountJson || !spreadsheetId) {
    console.log("Google Sheets sync: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping.");
    return null;
  }
  return { accessToken: await getGoogleAccessToken(serviceAccountJson), spreadsheetId };
}

// Legacy append helper retained for compatibility with existing callers.
export async function appendTimesheetRow(row: (string | number)[]): Promise<void> {
  const access = await getSheetAccess();
  if (!access) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`Sheets append failed: ${res.status} ${await res.text()}`);
}

// Sheet1 columns for the new live timesheet flow:
// Entry ID | Staff Name | Signed In | Signed Out | Raw Hours | Payable Hours | Delta | In Address | Out Address | Status
const TIMESHEET_HEADER = ["Entry ID", "Staff Name", "Signed In", "Signed Out", "Raw Hours", "Payable Hours", "Delta", "In Address", "Out Address", "Status"];

async function ensureTimesheetHeader(accessToken: string, spreadsheetId: string): Promise<void> {
  const range = "Sheet1!A1:J1";
  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!getRes.ok) throw new Error(`Sheet1 header read failed: ${getRes.status} ${await getRes.text()}`);
  const data = await getRes.json();
  const first = data.values?.[0] ?? [];
  // Only write the new header when Sheet1 is empty. Existing sheets are left
  // untouched so historical data is never overwritten.
  if (first.length === 0) {
    const putRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [TIMESHEET_HEADER] }),
    });
    if (!putRes.ok) throw new Error(`Sheet1 header write failed: ${putRes.status} ${await putRes.text()}`);
  }
}

/**
 * Create or update the Sheet1 row for a single Supabase timesheet entry.
 * Call this at sign-in with status=open, then again at sign-out with the
 * completed values. Existing legacy rows remain untouched.
 */
export async function upsertTimesheetRow(entryId: string, row: (string | number)[]): Promise<void> {
  const access = await getSheetAccess();
  if (!access) return;
  await ensureTimesheetHeader(access.accessToken, access.spreadsheetId);

  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/Sheet1!A:A`, {
    headers: { Authorization: `Bearer ${access.accessToken}` },
  });
  if (!getRes.ok) throw new Error(`Sheet1 ID lookup failed: ${getRes.status} ${await getRes.text()}`);
  const data = await getRes.json();
  const values: string[][] = data.values ?? [];
  const matchIndex = values.findIndex((r) => r[0] === entryId);

  const rowValues = [entryId, ...row];
  if (matchIndex === -1) {
    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/Sheet1!A:J:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowValues] }),
    });
    if (!appendRes.ok) throw new Error(`Sheet1 timesheet append failed: ${appendRes.status} ${await appendRes.text()}`);
    return;
  }

  const sheetRow = matchIndex + 1;
  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/Sheet1!A${sheetRow}:J${sheetRow}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [rowValues] }),
  });
  if (!updateRes.ok) throw new Error(`Sheet1 timesheet update failed: ${updateRes.status} ${await updateRes.text()}`);
}

const FORTNIGHT_SHEET_TITLE = "Fortnight Summary";
const FORTNIGHT_SHEET_HEADER = ["Staff Name", "Pay Period", "Hours Worked", "Last Updated"];

async function ensureFortnightSheet(accessToken: string, spreadsheetId: string): Promise<void> {
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaRes.ok) throw new Error(`Sheets metadata fetch failed: ${metaRes.status} ${await metaRes.text()}`);
  const meta = await metaRes.json();
  const exists = (meta.sheets ?? []).some((s: { properties?: { title?: string } }) => s.properties?.title === FORTNIGHT_SHEET_TITLE);
  if (exists) return;
  const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: FORTNIGHT_SHEET_TITLE } } }] }),
  });
  if (!addRes.ok) throw new Error(`Adding "${FORTNIGHT_SHEET_TITLE}" tab failed: ${addRes.status} ${await addRes.text()}`);
  const headerRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A1:D1?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [FORTNIGHT_SHEET_HEADER] }),
  });
  if (!headerRes.ok) throw new Error(`Writing "${FORTNIGHT_SHEET_TITLE}" header failed: ${headerRes.status} ${await headerRes.text()}`);
}

export async function upsertFortnightSummary(staffName: string, periodLabel: string, totalHours: number): Promise<void> {
  const access = await getSheetAccess();
  if (!access) return;
  await ensureFortnightSheet(access.accessToken, access.spreadsheetId);
  const range = `${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A2:B`;
  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/${range}`, { headers: { Authorization: `Bearer ${access.accessToken}` } });
  if (!getRes.ok) throw new Error(`Fortnight summary read failed: ${getRes.status} ${await getRes.text()}`);
  const getData = await getRes.json();
  const rows: string[][] = getData.values ?? [];
  const matchIdx = rows.findIndex((r) => r[0] === staffName && r[1] === periodLabel);
  const rowValues = [staffName, periodLabel, Math.round(totalHours * 100) / 100, new Date().toISOString()];
  if (matchIdx === -1) {
    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A1:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowValues] }),
    });
    if (!appendRes.ok) throw new Error(`Fortnight summary append failed: ${appendRes.status} ${await appendRes.text()}`);
    return;
  }
  const sheetRow = matchIdx + 2;
  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${access.spreadsheetId}/values/${encodeURIComponent(FORTNIGHT_SHEET_TITLE)}!A${sheetRow}:D${sheetRow}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [rowValues] }),
  });
  if (!updateRes.ok) throw new Error(`Fortnight summary update failed: ${updateRes.status} ${await updateRes.text()}`);
}
