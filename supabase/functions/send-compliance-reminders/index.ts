// supabase/functions/send-compliance-reminders/index.ts
//
// Called daily by a scheduled GitHub Action
// (.github/workflows/compliance-reminders.yml). Two jobs in one function:
//   1. Find everyone due a reminder today and email them via Resend, then
//      log what was sent so the same tier never goes out twice.
//   2. Purge compliance submissions uploaded more than RETENTION_YEARS ago
//      (Privacy Act 1988 retention policy) by deleting the storage file —
//      the on_compliance_doc_deleted DB trigger then removes the matching
//      compliance_submissions row automatically, so the file and its
//      record can never drift out of sync.
//
// Required environment variables (set via `supabase secrets set`):
//   SUPABASE_URL              - your project URL
//   SUPABASE_SERVICE_ROLE_KEY - service role key (bypasses RLS, needed to
//                                read across all staff and write the log)
//   RESEND_API_KEY             - your Resend API key
//   CRON_SECRET                - a random string only you and the GitHub
//                                Action know, checked below so this
//                                function can't be triggered by anyone
//                                who finds the URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REMINDER_SUBJECTS: Record<string, string> = {
  "30_day": "Compliance document due in 30 days",
  "14_day": "Compliance document due in 14 days",
  "7_day": "Compliance document due in 7 days",
  "overdue": "Compliance document overdue",
};

const RETENTION_YEARS = 2;
const COMPLIANCE_BUCKET = "compliance-docs";

function buildEmailBody(row: {
  staff_name: string;
  document_type_name: string;
  due_date: string;
  reminder_type: string;
}) {
  const dueDateFormatted = new Date(row.due_date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (row.reminder_type === "overdue") {
    return `Hi ${row.staff_name},\n\nYour ${row.document_type_name} was due on ${dueDateFormatted} and is now overdue. Please upload it as soon as possible via the ACP staff portal.\n\nKind regards,\nACP Compliance`;
  }

  return `Hi ${row.staff_name},\n\nThis is a reminder that your ${row.document_type_name} is due on ${dueDateFormatted}. Please upload it via the ACP staff portal before this date.\n\nKind regards,\nACP Compliance`;
}

async function sendReminders(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  resendApiKey: string,
) {
  const { data: dueReminders, error } = await supabase.rpc("get_due_reminders");

  if (error) {
    console.error("get_due_reminders failed:", error);
    return { sent: 0, failed: 1, failures: [`get_due_reminders: ${error.message}`] };
  }

  let sentCount = 0;
  const failures: string[] = [];

  for (const row of dueReminders ?? []) {
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "ACP Compliance <compliance@edu.acponline.com.au>",
          to: row.staff_email,
          subject: REMINDER_SUBJECTS[row.reminder_type],
          text: buildEmailBody(row),
        }),
      });

      if (!emailResponse.ok) {
        const errText = await emailResponse.text();
        failures.push(`${row.staff_email} (${row.reminder_type}): ${errText}`);
        continue;
      }

      // Only log as sent once the email actually succeeded
      const { error: logError } = await supabase
        .from("compliance_reminder_log")
        .insert({
          requirement_id: row.requirement_id,
          reminder_type: row.reminder_type,
        });

      if (logError) {
        failures.push(`${row.staff_email} (${row.reminder_type}) log insert failed: ${logError.message}`);
        continue;
      }

      sentCount++;
    } catch (err) {
      failures.push(`${row.staff_email} (${row.reminder_type}): ${String(err)}`);
    }
  }

  return { sent: sentCount, failed: failures.length, failures };
}

async function purgeExpiredSubmissions(
  // deno-lint-ignore no-explicit-any
  supabase: any,
) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);

  const { data: expired, error } = await supabase
    .from("compliance_submissions")
    .select("id, file_path")
    .lt("uploaded_at", cutoff.toISOString());

  if (error) {
    console.error("purge query failed:", error);
    return { purged: 0, failed: 1, failures: [`query: ${error.message}`] };
  }

  if (!expired || expired.length === 0) {
    return { purged: 0, failed: 0, failures: [] };
  }

  // Deleting the storage object is the source-of-truth action — the
  // on_compliance_doc_deleted DB trigger then removes the matching
  // compliance_submissions row automatically, so the file and its record
  // stay in sync regardless of how the file gets deleted (here, from the
  // Storage dashboard, or from a future manager "delete" button).
  const paths = expired.map((r: { file_path: string }) => r.file_path);
  const { data: removed, error: removeError } = await supabase.storage
    .from(COMPLIANCE_BUCKET)
    .remove(paths);

  if (removeError) {
    console.error("storage remove failed:", removeError);
    return { purged: 0, failed: expired.length, failures: [`storage remove: ${removeError.message}`] };
  }

  // deno-lint-ignore no-explicit-any
  const removedPaths = new Set((removed ?? []).map((f: any) => f.name));
  const failures = expired
    .filter((r: { file_path: string }) => !removedPaths.has(r.file_path))
    .map((r: { id: string; file_path: string }) => `submission ${r.id} (${r.file_path}): not confirmed removed`);

  return { purged: removedPaths.size, failed: failures.length, failures };
}

Deno.serve(async (req) => {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

  const reminders = await sendReminders(supabase, resendApiKey);
  const purge = await purgeExpiredSubmissions(supabase);

  return new Response(
    JSON.stringify({ reminders, purge }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
