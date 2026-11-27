import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return json(401, { error: "Authentication required" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !anon) return json(500, { error: "QR pass service is not configured" });

    const client = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    });

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) {
      return json(401, { error: "Your session has expired. Please sign in again." });
    }

    let body: { studentId?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: "Invalid request" }); }
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    if (!studentId) return json(400, { error: "Choose a linked child." });

    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const p_token = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p_token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");

    const { data: student, error: issueError } = await client.rpc("get_or_create_parent_student_qr", {
      p_student_id: studentId,
      p_token,
      p_token_hash: tokenHash,
    });

    if (issueError || !student) {
      console.error("parent QR issuance failed", issueError?.message ?? "No student returned");
      return json(500, {
        error: issueError?.message?.includes("not linked")
          ? "This child is not linked to your family account."
          : "The student QR pass could not be prepared. Please try again.",
      });
    }

    return json(200, {
      success: true,
      token: student.token,
      student: {
        id: student.student_id,
        fullName: student.full_name,
        className: student.class_name,
      },
    });
  } catch (error) {
    console.error("parent QR pass failed", error);
    return json(500, { error: "The student QR pass could not be prepared." });
  }
});