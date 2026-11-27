import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json(405,{error:"Method not allowed"});
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json(500,{error:"Staff service is not configured"});
 const publicClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}}),{data:user,error:userError}=await publicClient.auth.getUser(auth.slice(7));if(userError||!user.user)return json(401,{error:"Invalid or expired session"});
 let body:{schoolId?:unknown;membershipId?:unknown;status?:unknown};try{body=await req.json();}catch{return json(400,{error:"Invalid request"});}
 const schoolId=typeof body.schoolId==="string"?body.schoolId:"",membershipId=typeof body.membershipId==="string"?body.membershipId:"",status=body.status==="active"?"active":body.status==="inactive"?"inactive":null;if(!schoolId||!membershipId||!status)return json(400,{error:"Choose a valid staff account and status."});
 const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:actor}=await admin.from("profiles").select("is_active").eq("id",user.user.id).maybeSingle();if(!actor||actor.is_active!==true)return json(403,{error:"An active account is required."});
 const {data:adminMembership}=await admin.from("school_memberships").select("id").eq("school_id",schoolId).eq("user_id",user.user.id).eq("role","school_admin").eq("status","active").maybeSingle();if(!adminMembership)return json(403,{error:"You can only manage staff in a school you administer."});
 const {data:target,error:targetError}=await admin.from("school_memberships").select("id,user_id,role,status,profiles(full_name)").eq("id",membershipId).eq("school_id",schoolId).in("role",["staff","gate_staff"]).maybeSingle();if(targetError||!target)return json(404,{error:"Staff account not found in this school."});
 if(target.status===status)return json(200,{success:true,status});
 const {error:updateError}=await admin.from("school_memberships").update({status}).eq("id",membershipId).eq("school_id",schoolId);if(updateError)return json(500,{error:"Could not update staff access."});
 const {error:auditError}=await admin.from("audit_logs").insert({school_id:schoolId,actor_user_id:user.user.id,action:status==="inactive"?"staff.access_suspended":"staff.access_restored",entity_type:"school_membership",entity_id:membershipId,metadata:{staff_name:(target.profiles as {full_name:string}|null)?.full_name??"Staff member",role:target.role,previous_status:target.status,new_status:status}});
 if(auditError)console.error("staff status audit log failed",auditError.message);
 return json(200,{success:true,status});
});