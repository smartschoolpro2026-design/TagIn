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

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse(401, { error: "Authentication required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(500, { error: "Account service is not configured" });
  }

  const accessToken = authorization.slice("Bearer ".length);
  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await publicClient.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonResponse(401, { error: "Your session is invalid. Sign in again." });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: actor, error: actorError } = await adminClient
    .from("profiles").select("platform_role,is_active").eq("id", authData.user.id).maybeSingle();
  if (actorError || actor?.platform_role !== "super_admin" || actor.is_active !== true) {
    return jsonResponse(403, { error: "Only an active platform administrator can create school administrators." });
  }

  let body: { schoolId?: unknown; fullName?: unknown; phone?: unknown };
  try { body = await request.json(); } catch { return jsonResponse(400, { error: "Invalid request." }); }

  const schoolId = typeof body.schoolId === "string" ? body.schoolId : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const phone = normalizePhone(body.phone);
  if (!schoolId || fullName.length < 2 || fullName.length > 160 || !phone) {
    return jsonResponse(400, { error: "Enter a valid school, administrator name, and phone number." });
  }

  const { data: school, error: schoolError } = await adminClient
    .from("schools").select("id,status").eq("id", schoolId).maybeSingle();
  if (schoolError || !school || school.status !== "active") {
    return jsonResponse(400, { error: "Choose an active school before assigning its administrator." });
  }

  const { data: existing } = await adminClient.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (existing) return jsonResponse(409, { error: "An account already uses this phone number. Use a different number." });

  const email = await authAlias(phone);
  const password = temporaryPassword();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (createError || !created.user) {
    return jsonResponse(400, { error: "Could not create the administrator login. Check that this phone number is not already registered." });
  }

  const userId = created.user.id;
  const { error: profileError } = await adminClient.from("profiles").insert({
    id: userId,
    full_name: fullName,
    phone,
    platform_role: "user",
    is_active: true,
    must_change_password: true,
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return jsonResponse(500, { error: "The administrator profile could not be saved. No account was retained." });
  }

  const { error: membershipError } = await adminClient.from("school_memberships").insert({
    school_id: schoolId,
    user_id: userId,
    role: "school_admin",
    status: "active",
  });
  if (membershipError) {
    await adminClient.from("profiles").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
    return jsonResponse(500, { error: "The school assignment could not be saved. No account was retained." });
  }

  return jsonResponse(200, {
    success: true,
    administrator: { fullName, phone },
    temporaryPassword: password,
  });
});
