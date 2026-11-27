import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function response(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
function normalizePhone(value:unknown):string|null{if(typeof value!=="string"||value.length>40)return null;let p=value.trim().replace(/[ ().-]/g,"");if(p.startsWith("00"))p="+"+p.slice(2);if(p.length===11&&p[0]==="0")p="+234"+p.slice(1);if(!p.startsWith("+")||p.length<9||p.length>16||!Array.from(p.slice(1)).every(c=>c>="0"&&c<="9"))return null;return p;}
async function authAlias(phone:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(phone));const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");return "u-"+hex+"@login.tagin.invalid";}
function temporaryPassword(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const bytes=crypto.getRandomValues(new Uint8Array(20));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return response(405,{error:"Method not allowed"});
 const authorization=req.headers.get("Authorization");if(!authorization?.startsWith("Bearer "))return response(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return response(500,{error:"Staff account service is not configured"});
 const publicClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}}),{data:auth,error:authError}=await publicClient.auth.getUser(authorization.slice(7));
 if(authError||!auth.user)return response(401,{error:"Your session could not be verified. Sign in again."});
 const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:actor,error:actorError}=await admin.from("profiles").select("is_active").eq("id",auth.user.id).maybeSingle();
 if(actorError||!actor||actor.is_active!==true)return response(403,{error:"An active school administrator account is required."});
 let body:{schoolId?:unknown;fullName?:unknown;phone?:unknown;role?:unknown;jobTitle?:unknown;department?:unknown};try{body=await req.json();}catch{return response(400,{error:"Invalid request."});}
 const schoolId=typeof body.schoolId==="string"?body.schoolId:"",fullName=typeof body.fullName==="string"?body.fullName.trim():"",phone=normalizePhone(body.phone),role=body.role==="gate_staff"?"gate_staff":body.role==="teacher"?"staff":null,jobTitle=typeof body.jobTitle==="string"?body.jobTitle.trim():"",department=typeof body.department==="string"?body.department.trim():"";
 if(!schoolId||fullName.length<2||fullName.length>160||!phone||!role||jobTitle.length<2||jobTitle.length>80||department.length>80)return response(400,{error:"Enter a valid name, phone number, role and job title."});
 const {data:membership,error:membershipError}=await admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",auth.user.id).eq("role","school_admin").eq("status","active").maybeSingle();
 if(membershipError||!membership)return response(403,{error:"You can only create staff accounts for a school you administer."});
 const {data:school,error:schoolError}=await admin.from("schools").select("id,status").eq("id",schoolId).maybeSingle();if(schoolError||!school||school.status!=="active")return response(400,{error:"This school is not active."});
 const {data:existing}=await admin.from("profiles").select("id").eq("phone",phone).maybeSingle();if(existing)return response(409,{error:"An account already uses this phone number. Ask the platform administrator for help instead."});
 const email=await authAlias(phone),password=temporaryPassword(),{data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName,phone}});
 if(createError||!created.user){console.error("staff auth creation failed",createError?.message);return response(400,{error:"Could not create this staff login. Check the phone number and try again."});}
 const userId=created.user.id,expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
 const {error:profileError}=await admin.from("profiles").insert({id:userId,full_name:fullName,phone,platform_role:"user",is_active:true,must_change_password:true,temporary_password_expires_at:expiresAt});
 if(profileError){await admin.auth.admin.deleteUser(userId);console.error("staff profile insert failed",profileError.message);return response(500,{error:"The staff profile could not be saved. No account was retained."});}
 const {data:newMembership,error:newMembershipError}=await admin.from("school_memberships").insert({school_id:schoolId,user_id:userId,role,status:"active"}).select("id").single();
 if(newMembershipError||!newMembership){await admin.auth.admin.deleteUser(userId);console.error("staff membership insert failed",newMembershipError?.message);return response(500,{error:"The school staff assignment could not be saved. No account was retained."});}
 if(role==="staff"){
  const {error:staffProfileError}=await admin.from("staff_profiles").insert({membership_id:newMembership.id,job_title:jobTitle,department:department||null});
  if(staffProfileError){await admin.from("school_memberships").delete().eq("id",newMembership.id);await admin.auth.admin.deleteUser(userId);console.error("staff details insert failed",staffProfileError.message);return response(500,{error:"The staff details could not be saved. No account was retained."});}
  const {error:permissionError}=await admin.from("staff_permissions").insert([{membership_id:newMembership.id,permission_key:"students.read_basic",granted_by:auth.user.id},{membership_id:newMembership.id,permission_key:"gate.check_in",granted_by:auth.user.id},{membership_id:newMembership.id,permission_key:"gate.check_out",granted_by:auth.user.id}]);
  if(permissionError){await admin.from("school_memberships").delete().eq("id",newMembership.id);await admin.auth.admin.deleteUser(userId);console.error("staff permissions insert failed",permissionError.message);return response(500,{error:"The staff permissions could not be saved. No account was retained."});}
 }
 const {error:auditError}=await admin.from("audit_logs").insert({school_id:schoolId,actor_user_id:auth.user.id,action:"staff.created",entity_type:"school_membership",entity_id:newMembership.id,metadata:{staff_name:fullName,staff_role:role==="staff"?"teacher":"gate_staff",phone}});
 if(auditError)console.error("staff audit log insert failed",auditError.message);
 return response(200,{success:true,staff:{fullName,phone,role:role==="staff"?"teacher":"gate_staff"},temporaryPassword:password});
});