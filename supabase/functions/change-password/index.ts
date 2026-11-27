import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function jsonResponse(status: number, body: Record<string, unknown>) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
Deno.serve(async (req: Request) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
 if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
 const authorization = req.headers.get("Authorization"); if (!authorization?.startsWith("Bearer ")) return jsonResponse(401, { error: "Authentication required" });
 const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if (!url || !anon || !service) return jsonResponse(500, { error: "Server configuration is incomplete" });
 const publicClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }), { data, error: authError } = await publicClient.auth.getUser(authorization.slice(7));
 if (authError || !data.user) return jsonResponse(401, { error: "Invalid or expired session" });
 const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
 const { error } = await admin.from("profiles").update({ must_change_password: false, temporary_password_expires_at: null }).eq("id", data.user.id);
 if (error) return jsonResponse(500, { error: "Could not finalize account setup" });
 const { data: memberships } = await admin.from("school_memberships").select("school_id").eq("user_id", data.user.id).eq("status", "active");
 const schoolIds = [...new Set((memberships ?? []).map(item => item.school_id))];
 const records = (schoolIds.length ? schoolIds : [null]).map(school_id => ({
  school_id, actor_user_id: data.user.id, action: "auth.password_changed",
  entity_type: "profile", entity_id: data.user.id, metadata: { source: "account_setup" },
 }));
 const { error: auditError } = await admin.from("audit_logs").insert(records);
 if (auditError) console.error("password change audit insert failed", auditError.message);
 return jsonResponse(200, { success: true });
});