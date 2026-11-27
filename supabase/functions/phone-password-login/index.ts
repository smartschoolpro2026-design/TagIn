import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  let compact = value.trim().replace(/[ ().-]/g, "");
  if (compact.startsWith("00")) compact = "+" + compact.slice(2);
  if (compact.length === 11 && compact[0] === "0") compact = "+234" + compact.slice(1);
  if (!compact.startsWith("+") || compact.length < 9 || compact.length > 16) return null;
  if (!Array.from(compact.slice(1)).every((character) => character >= "0" && character <= "9")) return null;
  return compact;
}

async function authAlias(phone: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return "u-" + hex + "@login.tagin.invalid";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  let body: { phone?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request" });
  }

  const phone = normalizePhone(body.phone);
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || password.length < 1 || password.length > 128) {
    return jsonResponse(401, { error: "Phone number or password is incorrect" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) return jsonResponse(500, { error: "Authentication service is unavailable" });

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = await authAlias(phone);
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    return jsonResponse(401, { error: "Phone number or password is incorrect" });
  }

  return jsonResponse(200, { session: data.session });
});
