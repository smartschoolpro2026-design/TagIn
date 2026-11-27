import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function jsonResponse(status: number, body: Record<string, unknown>) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function normalizePhone(value: unknown): string | null { if (typeof value !== "string" || value.length > 40) return null; let p = value.trim().replace(/[ ().-]/g, ""); if (p.startsWith("00")) p = "+" + p.slice(2); if (p.length === 11 && p[0] === "0") p = "+234" + p.slice(1); if (!p.startsWith("+") || p.length < 9 || p.length > 16 || !Array.from(p.slice(1)).every(c => c >= "0" && c <= "9")) return null; return p; }
async function authAlias(phone: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone)); const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""); return "u-" + hex + "@login.tagin.invalid"; }
async function recordLoginAttempt(admin: ReturnType<typeof createClient>, phone: string, action: string) {
 const { data: target } = await admin.from("profiles").select("id,full_name").eq("phone", phone).maybeSingle();
 if (!target) {
  await admin.from("audit_logs").insert({ actor_user_id: null, action, entity_type: "auth_attempt", metadata: { reason: action === "auth.login_failed" ? "invalid_credentials" : "account_blocked", attempted_account_exists: false } });
  return;
 }
 const { data: memberships } = await admin.from("school_memberships").select("school_id").eq("user_id", target.id);
 const schoolIds = [...new Set((memberships ?? []).map(item => item.school_id))];
 const records = (schoolIds.length ? schoolIds : [null]).map(school_id => ({
  school_id, actor_user_id: null, action, entity_type: "auth_attempt", entity_id: target.id,
  metadata: { reason: action === "auth.login_failed" ? "invalid_credentials" : "account_blocked", attempted_account_exists: true, attempted_name: target.full_name }
 }));
 await admin.from("audit_logs").insert(records);
}
Deno.serve(async (req: Request) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
 if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
 let body: { phone?: unknown; password?: unknown }; try { body = await req.json(); } catch { return jsonResponse(400, { error: "Invalid request" }); }
 const phone = normalizePhone(body.phone), password = typeof body.password === "string" ? body.password : "";
 if (!phone || !password || password.length > 128) return jsonResponse(401, { error: "Phone number or password is incorrect" });
 const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if (!url || !anon || !service) return jsonResponse(500, { error: "Authentication service is unavailable" });
 const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
 const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
 const email = await authAlias(phone), { data, error } = await client.auth.signInWithPassword({ email, password });
 if (error || !data.session) {
  await recordLoginAttempt(admin, phone, "auth.login_failed");
  return jsonResponse(401, { error: "Phone number or password is incorrect" });
 }
 const { data: profile, error: profileError } = await admin.from("profiles").select("is_active,must_change_password,temporary_password_expires_at").eq("id", data.user.id).maybeSingle();
 if (profileError || !profile || profile.is_active !== true) {
  await recordLoginAttempt(admin, phone, "auth.login_blocked");
  return jsonResponse(403, { error: "This account is inactive. Contact your school administrator." });
 }
 if (profile.must_change_password && profile.temporary_password_expires_at && new Date(profile.temporary_password_expires_at).getTime() < Date.now()) return jsonResponse(403, { error: "This temporary password has expired. Contact your school administrator to request a new one." });
 return jsonResponse(200, { session: data.session });
});