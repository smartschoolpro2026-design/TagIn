import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
function phoneNumber(value:unknown):string|null{if(typeof value!=="string"||value.length>40)return null;let p=value.trim().replace(/[ ().-]/g,"");if(p.startsWith("00"))p="+"+p.slice(2);if(p.length===11&&p[0]==="0")p="+234"+p.slice(1);if(!p.startsWith("+")||p.length<9||p.length>16||!Array.from(p.slice(1)).every(c=>c>="0"&&c<="9"))return null;return p;}
async function alias(phone:string){const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(phone));return "u-"+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")+"@login.tagin.invalid";}
function tempPassword(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const bytes=crypto.getRandomValues(new Uint8Array(20));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json(405,{error:"Method not allowed"});
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json(500,{error:"Parent account service is not configured"});
 const publicClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}}),{data:authData,error:authError}=await publicClient.auth.getUser(auth.slice(7));if(authError||!authData.user)return json(401,{error:"Invalid or expired session"});
 let body:{schoolId?:unknown;studentId?:unknown;fullName?:unknown;phone?:unknown;relationship?:unknown;primary?:unknown};try{body=await req.json();}catch{return json(400,{error:"Invalid request"});}
 const schoolId=typeof body.schoolId==="string"?body.schoolId:"",studentId=typeof body.studentId==="string"?body.studentId:"",fullName=typeof body.fullName==="string"?body.fullName.trim():"",phone=phoneNumber(body.phone),relationship=typeof body.relationship==="string"?body.relationship.trim():"Guardian",primary=body.primary===true;
 if(!schoolId||!studentId||fullName.length<2||fullName.length>160||!phone||relationship.length<2||relationship.length>40)return json(400,{error:"Enter a valid parent name, phone number, relationship and student."});
 const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:schoolAdmin,error:adminError}=await admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",authData.user.id).eq("role","school_admin").eq("status","active").maybeSingle();if(adminError||!schoolAdmin)return json(403,{error:"You can only link parents in a school you administer."});
 const {data:school}=await admin.from("schools").select("id,status").eq("id",schoolId).maybeSingle();if(!school||school.status!=="active")return json(400,{error:"This school is not active."});
 const {data:student}=await admin.from("students").select("id,full_name,active").eq("id",studentId).eq("school_id",schoolId).maybeSingle();if(!student||!student.active)return json(404,{error:"Active student not found in this school."});
 let userId:string,isNewAccount=false,password:string|undefined;
 const {data:existing,error:lookupError}=await admin.from("profiles").select("id,is_active").eq("phone",phone).maybeSingle();if(lookupError)return json(500,{error:"Could not verify the parent account."});
 if(existing){if(existing.is_active!==true)return json(403,{error:"An inactive TagIn account uses this phone number. Contact platform support before linking it."});userId=existing.id;}
 else{
  isNewAccount=true;password=tempPassword();const {data:authUser,error:createError}=await admin.auth.admin.createUser({email:await alias(phone),password,email_confirm:true,user_metadata:{full_name:fullName,phone}});
  if(createError||!authUser.user){console.error("parent auth create failed",createError?.message);return json(400,{error:"Could not create the parent login. Check the phone number and try again."});}
  userId=authUser.user.id;const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
  const {error:profileError}=await admin.from("profiles").insert({id:userId,full_name:fullName,phone,platform_role:"user",is_active:true,must_change_password:true,temporary_password_expires_at:expiresAt});
  if(profileError){await admin.auth.admin.deleteUser(userId);console.error("parent profile insert failed",profileError.message);return json(500,{error:"The parent profile could not be saved. No account was retained."});}
  const {error:membershipError}=await admin.from("school_memberships").insert({school_id:schoolId,user_id:userId,role:"parent",status:"active"});
  if(membershipError){await admin.auth.admin.deleteUser(userId);console.error("parent membership insert failed",membershipError.message);return json(500,{error:"The parent school access could not be saved. No account was retained."});}
 }
 const {data:guardian,error:guardianError}=await admin.from("guardians").upsert({school_id:schoolId,user_id:userId,full_name,phone,relationship},{onConflict:"school_id,user_id"}).select("id").single();
 if(guardianError||!guardian){if(isNewAccount)await admin.auth.admin.deleteUser(userId);console.error("guardian record save failed",guardianError?.message);return json(500,{error:"The parent profile could not be linked to this school."});}
 const {error:linkError}=await admin.from("student_guardians").upsert({school_id:schoolId,student_id:studentId,guardian_id:guardian.id,is_primary:primary},{onConflict:"student_id,guardian_id"});
 if(linkError){if(isNewAccount){await admin.from("guardians").delete().eq("id",guardian.id);await admin.auth.admin.deleteUser(userId);}console.error("student guardian link failed",linkError.message);return json(500,{error:"The parent account exists, but the student link could not be saved. Please try again."});}
 if(primary){const {error:resetPrimaryError}=await admin.from("student_guardians").update({is_primary:false}).eq("school_id",schoolId).eq("student_id",studentId).neq("guardian_id",guardian.id);if(resetPrimaryError)console.error("primary guardian update failed",resetPrimaryError.message);}
 const {error:auditError}=await admin.from("audit_logs").insert({school_id:schoolId,actor_user_id:authData.user.id,action:"parent.linked",entity_type:"student_guardian",entity_id:studentId,metadata:{parent_name:fullName,phone,relationship,student_name:student.full_name,is_primary:primary,new_account:isNewAccount}});
 if(auditError)console.error("parent link audit failed",auditError.message);
 return json(200,{success:true,isNewAccount,parent:{fullName,phone,relationship},...(password?{temporaryPassword:password}:{})});
});