// Shared subject/body formatting for every ACP Staff Hub transactional
// email sent via Resend (timesheet GPS-failure alerts, auto sign-out
// notices, compliance reminders) — keeps the timestamped subject, Lexend
// font, and signature consistent everywhere instead of copy-pasting the
// same formatting into each function.

const SIGNATURE_TEXT = "\n\nAged Care Physiotherapy\nStaff HUB";
const SIGNATURE_HTML = `<p style="margin-top:24px;">Aged Care Physiotherapy<br>Staff HUB</p>`;

// dd/mm/yy hh:mm:ss, Sydney local time — appended to every subject line so
// staff/managers can tell otherwise-similar emails apart at a glance.
export function timestamp(): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function withTimestamp(subject: string): string {
  return `${subject} — ${timestamp()}`;
}

export function wrapText(body: string): string {
  return `${body}${SIGNATURE_TEXT}`;
}

// Lexend is loaded via @import for the email clients that honour it
// (Apple Mail, most webmail); the inline font-family's fallback stack
// keeps things legible on clients that strip <style>/@import (Outlook
// desktop, some mobile mail apps).
export function wrapHtml(bodyHtml: string): string {
  return `<div style="font-family:'Lexend',Arial,sans-serif;font-size:10px;line-height:1.6;color:#1a1a1a;">
<style>@import url('https://fonts.googleapis.com/css2?family=Lexend&display=swap');</style>
${bodyHtml}
${SIGNATURE_HTML}
</div>`;
}
