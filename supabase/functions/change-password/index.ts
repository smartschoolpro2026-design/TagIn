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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse(401, { error: "Authentication required" });

  let body: { newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request body" });
  }
  if (typeof body.newPassword !== "string" || body.newPassword.length < 12) {
    return jsonResponse(400, { error: "Password must be at least 12 characters" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse(500, { error: "Server configuration is incomplete" });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(401, { error: "Invalid or expired session" });

  const { error: passwordError } = await userClient.auth.updateUser({ password: body.newPassword });
  if (passwordError) return jsonResponse(400, { error: passwordError.message });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: profileError } = await adminClient
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", userData.user.id);
  if (profileError) {
    return jsonResponse(500, { error: "Password changed, but account setup could not be finalized. Contact your administrator." });
  }

  return jsonResponse(200, { success: true });
});
