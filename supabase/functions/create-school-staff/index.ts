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
 const schoolId=typeof body.schoolId==="string"?body.schoolId:"",fullName=typeof body.fullName==="string"?body.fullName.trim():"",phone=normalizePhone(body.phone),role=body.role==="gate_staff"?"gate_staff":body.role==="bus_staff"?"bus_staff":body.role==="teacher"?"staff":null,jobTitle=typeof body.jobTitle==="string"?body.jobTitle.trim():"",department=typeof body.department==="string"?body.department.trim():"";
 if(!schoolId||fullName.length<2||fullName.length>160||!phone||!role||jobTitle.length<2||jobTitle.length>80||department.length>80)return response(400,{error:"Enter a valid name, phone number, role and job title."});
 const {data:membership,error:membershipError}=await admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",auth.user.id).eq("role","school_admin").eq("status","active").maybeSingle();
 if(membershipError||!membership)return response(403,{error:"You can only create staff accounts for a school you administer."});
 const {data:school,error:schoolError}=await admin.from("schools").select("id,status").eq("id",schoolId).maybeSingle();if(schoolError||!school||school.status!=="active")return response(400,{error:"This school is not active."});
 const {data:existing,error:existingError}=await admin.from("profiles").select("id,full_name,is_active").eq("phone",phone).maybeSingle();
 if(existingError)return response(500,{error:"Could not check whether this phone number already has a TagIn account."});
 let userId:string,password:string|undefined,isExistingAccount=false;
 if(existing){
  if(existing.is_active!==true)return response(403,{error:"An inactive TagIn account uses this phone number. Contact platform support."});
  const [{data:parentMembership,error:parentMembershipError},{data:guardian,error:guardianError}]=await Promise.all([
   admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",existing.id).eq("role","parent").eq("status","active").maybeSingle(),
   admin.from("guardians").select("id").eq("school_id",schoolId).eq("user_id",existing.id).maybeSingle()
  ]);
  if(parentMembershipError||guardianError)return response(500,{error:"Could not verify the existing account's relationship with this school."});
  if(!parentMembership&&!guardian)return response(409,{error:"This phone number already belongs to a different TagIn account. For security, it can only be reused when the account is already a parent or guardian at this school."});
  const {data:priorRole,error:priorRoleError}=await admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",existing.id).eq("role",role).maybeSingle();
  if(priorRoleError)return response(500,{error:"Could not check the existing school staff assignment."});
  if(priorRole)return response(409,{error:"This person already has this staff role at your school. You can manage their existing staff access instead."});
  userId=existing.id;isExistingAccount=true;
 }else{
  const email=await authAlias(phone),newPassword=temporaryPassword(),{data:created,error:createError}=await admin.auth.admin.createUser({email,password:newPassword,email_confirm:true,user_metadata:{full_name:fullName,phone}});
  if(createError||!created.user){console.error("staff auth creation failed",{code:createError?.code,status:createError?.status,message:createError?.message});const authMessage=(createError?.message??"").toLowerCase();const safeMessage=authMessage.includes("already")||authMessage.includes("registered")?"A login already exists for this phone number but TagIn could not match it to an active profile. Please contact support so we can safely reconnect it.":authMessage.includes("password")?"The secure login could not be created because the password was rejected. Please try again.":"Supabase could not create this login. Please try again; if it continues, share the detailed message shown here with support.";return response(400,{error:safeMessage,code:createError?.code??null});}
  userId=created.user.id;password=newPassword;
  const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
  const {error:profileError}=await admin.from("profiles").insert({id:userId,full_name:fullName,phone,platform_role:"user",is_active:true,must_change_password:true,temporary_password_expires_at:expiresAt});
  if(profileError){await admin.auth.admin.deleteUser(userId);console.error("staff profile insert failed",profileError.message);return response(500,{error:"The staff profile could not be saved. No account was retained."});}
 }
 const {data:newMembership,error:newMembershipError}=await admin.from("school_memberships").insert({school_id:schoolId,user_id:userId,role,status:"active"}).select("id").single();
 if(newMembershipError||!newMembership){if(!isExistingAccount)await admin.auth.admin.deleteUser(userId);console.error("staff membership insert failed",newMembershipError?.message);return response(newMembershipError?.code==="23505"?409:500,{error:newMembershipError?.code==="23505"?"This staff role is already assigned to this account at your school.":"The school staff assignment could not be saved."});}
 if(role==="staff"){
  const {error:staffProfileError}=await admin.from("staff_profiles").insert({membership_id:newMembership.id,job_title:jobTitle,department:department||null});
  if(staffProfileError){await admin.from("school_memberships").delete().eq("id",newMembership.id);if(!isExistingAccount)await admin.auth.admin.deleteUser(userId);console.error("staff details insert failed",staffProfileError.message);return response(500,{error:"The staff details could not be saved. No new account or assignment was retained."});}
  const {error:permissionError}=await admin.from("staff_permissions").insert([{membership_id:newMembership.id,permission_key:"students.read_basic",granted_by:auth.user.id},{membership_id:newMembership.id,permission_key:"students.create",granted_by:auth.user.id},{membership_id:newMembership.id,permission_key:"gate.check_in",granted_by:auth.user.id},{membership_id:newMembership.id,permission_key:"gate.check_out",granted_by:auth.user.id}]);
  if(permissionError){await admin.from("school_memberships").delete().eq("id",newMembership.id);if(!isExistingAccount)await admin.auth.admin.deleteUser(userId);console.error("staff permissions insert failed",permissionError.message);return response(500,{error:"The staff permissions could not be saved. No new account or assignment was retained."});}
 }
 const {error:auditError}=await admin.from("audit_logs").insert({school_id:schoolId,actor_user_id:auth.user.id,action:"staff.created",entity_type:"school_membership",entity_id:newMembership.id,metadata:{staff_name:isExistingAccount?existing!.full_name:fullName,existing_account_reused:isExistingAccount,staff_role:role==="staff"?"teacher":role==="bus_staff"?"bus_driver":"gate_staff",phone}});
 if(auditError)console.error("staff audit log insert failed",auditError.message);
 return response(200,{success:true,existingAccount:isExistingAccount,staff:{fullName:isExistingAccount?existing!.full_name:fullName,phone,role:role==="staff"?"teacher":role==="bus_staff"?"bus_staff":"gate_staff"},...(password?{temporaryPassword:password}:{})});
});