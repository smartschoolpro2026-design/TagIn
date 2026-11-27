import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
function json(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
function temporaryPassword(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const bytes=crypto.getRandomValues(new Uint8Array(24));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json(405,{error:"Method not allowed"});
 const authorization=req.headers.get("Authorization");if(!authorization?.startsWith("Bearer "))return json(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json(500,{error:"Password reset service is not configured"});
 const publicClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:auth,error:authError}=await publicClient.auth.getUser(authorization.slice(7));
 if(authError||!auth.user)return json(401,{error:"Your session could not be verified. Sign in again."});
 const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:actor,error:actorError}=await admin.from("profiles").select("platform_role,is_active").eq("id",auth.user.id).maybeSingle();
 if(actorError||!actor||actor.platform_role!=="super_admin"||actor.is_active!==true)return json(403,{error:"Only an active TagIn Platform Admin can approve password resets."});
 let body:{requestId?:unknown;action?:unknown};try{body=await req.json();}catch{return json(400,{error:"Invalid request."});}
 const requestId=typeof body.requestId==="string"?body.requestId:"",action=body.action==="approve"?"approve":body.action==="reject"?"reject":null;
 if(!requestId||!action)return json(400,{error:"Choose a valid reset request and action."});
 const {data:reset,error:resetError}=await admin.from("staff_password_reset_requests").select("id,school_id,membership_id,staff_user_id,status").eq("id",requestId).maybeSingle();
 if(resetError||!reset)return json(404,{error:"Password reset request not found."});
 if(reset.status!=="pending")return json(409,{error:"This request has already been reviewed."});
 const {data:membership,error:membershipError}=await admin.from("school_memberships").select("id,school_id,user_id,role,status").eq("id",reset.membership_id).eq("school_id",reset.school_id).maybeSingle();
 if(membershipError||!membership||membership.user_id!==reset.staff_user_id||!["staff","gate_staff","bus_staff"].includes(membership.role))return json(409,{error:"The staff assignment no longer matches this request."});
 if(action==="reject"){
  const {error:updateError}=await admin.from("staff_password_reset_requests").update({status:"rejected",reviewed_by:auth.user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",requestId).eq("status","pending");
  if(updateError)return json(500,{error:"Could not reject this request. Please retry."});
  return json(200,{success:true,status:"rejected"});
 }
 const {data:target,error:targetError}=await admin.from("profiles").select("full_name,phone,is_active").eq("id",reset.staff_user_id).maybeSingle();
 if(targetError||!target||target.is_active!==true)return json(409,{error:"The staff account is inactive or unavailable. Resolve the account status before resetting its password."});
 const password=temporaryPassword(),expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
 const {error:passwordError}=await admin.auth.admin.updateUserById(reset.staff_user_id,{password});
 if(passwordError){console.error("staff password reset update failed",passwordError.message);return json(500,{error:"Could not issue a temporary password. No reset was recorded."});}
 const {error:profileError}=await admin.from("profiles").update({must_change_password:true,temporary_password_expires_at:expiresAt,updated_at:new Date().toISOString()}).eq("id",reset.staff_user_id);
 if(profileError){console.error("staff password reset profile update failed",profileError.message);return json(500,{error:"The password was changed, but the forced-change flag could not be saved. Contact platform support before sharing the password."});}
 const {error:revokeError}=await admin.rpc("revoke_user_sessions",{p_user_id:reset.staff_user_id});
 if(revokeError){console.error("staff session revocation failed",revokeError.message);return json(500,{error:"The password was changed, but existing sessions could not be revoked. Do not share the temporary password yet; contact platform support."});}
 const {error:requestUpdateError}=await admin.from("staff_password_reset_requests").update({status:"fulfilled",reviewed_by:auth.user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",requestId).eq("status","pending");
 if(requestUpdateError){console.error("staff reset request update failed",requestUpdateError.message);return json(500,{error:"The temporary password was issued and sessions revoked, but the request status could not be updated. Contact platform support."});}
 const {error:auditError}=await admin.from("audit_logs").insert({school_id:reset.school_id,actor_user_id:auth.user.id,action:"staff.password_reset_approved",entity_type:"school_membership",entity_id:reset.membership_id,metadata:{request_id:requestId,staff_name:target.full_name,expires_at:expiresAt}});
 if(auditError)console.error("staff password reset audit insert failed",auditError.message);
 return json(200,{success:true,status:"fulfilled",staff:{fullName:target.full_name,phone:target.phone},temporaryPassword:password,expiresAt});
});