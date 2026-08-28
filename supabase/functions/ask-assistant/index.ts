// Role-scoped dashboard help bot.
//
// Answers questions about how to use the training/compliance dashboard,
// using only content stored in the `help_articles` table (managed from the
// "Help Content" manager tab — no redeploy needed to add or edit content).
//
// The caller's role is resolved server-side from `profiles`, using the
// service-role key — never trusted from the request body. A staff member's
// request can only ever retrieve `scope = 'staff'` articles; a manager's
// request retrieves 'staff' + 'manager'. This is the actual enforcement
// point for "staff can't learn about manager features" — the frontend
// widget doesn't need its own copy of this logic to be safe.
//
// Uses the Gemini API's free tier (Google AI Studio, not billed Vertex AI)
// rather than a paid model — get a key at https://aistudio.google.com/apikey
// and set it as the GEMINI_API_KEY secret. Called via plain fetch (no SDK)
// so there's no package to keep in sync. GEMINI_MODEL is optional and
// defaults below — override it if the default is ever retired; current
// options are listed at https://ai.google.dev/gemini-api/docs/models.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

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

    // Resolves *who* is asking from their own JWT.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not signed in" }, 401);
    }

    // Service-role client — the actual enforcement point. Never derive role
    // from anything the client sent; look it up ourselves.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role, status")
      .eq("id", userData.user.id)
      .single();
    if (profileErr || !profile || profile.status !== "approved") {
      return json({ error: "No approved profile found for this account" }, 403);
    }
    const isManager = profile.role === "manager";

    let question = "";
    try {
      const payload = await req.json();
      question = typeof payload?.question === "string" ? payload.question.trim() : "";
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    if (!question) {
      return json({ error: "Missing question" }, 400);
    }
    if (question.length > 2000) {
      return json({ error: "Question is too long" }, 400);
    }

    const scopes = isManager ? ["staff", "manager"] : ["staff"];
    const { data: articles, error: articlesErr } = await adminClient
      .from("help_articles")
      .select("title, body, scope")
      .in("scope", scopes)
      .eq("active", true);
    if (articlesErr) {
      console.error("help_articles query failed:", articlesErr);
      return json({ error: "Couldn't load help content — try again." }, 500);
    }

    const context = (articles ?? [])
      .map((a: { title: string; body: string; scope: string }) => `### ${a.title} (${a.scope})\n${a.body}`)
      .join("\n\n");

    const roleLine = isManager
      ? "The person asking is a manager. Managers can see both staff and manager-only material."
      : "The person asking is a staff member. This user must NEVER be told about manager-only features, screens, or tabs — if a manager-only topic isn't in your reference material below, say you don't have information on that and suggest they ask their manager. Do not guess or infer what manager tools might exist.";

    const systemPrompt = `You are the in-app help assistant for the Aged Care Physiotherapy staff training & compliance dashboard.
Answer only using the reference material below. If the answer isn't in it, say you don't know rather than guessing.
${roleLine}
Keep answers short and practical — a few sentences, plain language, no markdown headers or code blocks.

Reference material:
${context || "(no help content has been added yet)"}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: question }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errBody);
      return json({ error: "Something went wrong answering that — try again." }, 502);
    }

    const geminiData = await geminiRes.json();
    // The whole prompt can be blocked before any candidate is generated
    // (promptFeedback.blockReason) — distinct from a per-candidate
    // finishReason like SAFETY/RECITATION, which leaves candidates empty too.
    const blockReason = geminiData?.promptFeedback?.blockReason;
    const candidate = geminiData?.candidates?.[0];
    const answer = candidate?.content?.parts?.[0]?.text
      ?? (blockReason || candidate?.finishReason === "SAFETY"
        ? "I can't answer that one — try rephrasing, or ask your line manager."
        : "Sorry, I couldn't generate an answer — try again.");

    return json({ answer });
  } catch (err) {
    console.error("ask-assistant failed:", err);
    return json({ error: "Something went wrong answering that — try again." }, 500);
  }
});
