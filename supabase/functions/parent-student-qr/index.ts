import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
Deno.serve(async(req:Request)=>{try{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json(405,{error:"Method not allowed"});
 const authorization=req.headers.get("Authorization");if(!authorization?.startsWith("Bearer "))return json(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json(500,{error:"QR pass service is not configured"});
 const publicClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:authData,error:authError}=await publicClient.auth.getUser(authorization.slice(7));
 if(authError||!authData.user)return json(401,{error:"Your session has expired. Please sign in again."});
 let body:{studentId?:unknown};try{body=await req.json();}catch{return json(400,{error:"Invalid request"});}
 const studentId=typeof body.studentId==="string"?body.studentId:"";if(!studentId)return json(400,{error:"Choose a linked child."});
 const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:student,error:studentError}=await admin.from("students").select("id,school_id,full_name,class_name,level,active").eq("id",studentId).maybeSingle();
 if(studentError||!student||student.active!==true)return json(404,{error:"This student is not available."});
 const {data:guardians,error:guardianError}=await admin.from("guardians").select("id").eq("user_id",authData.user.id).eq("school_id",student.school_id);
 if(guardianError)return json(500,{error:"Could not verify this family link."});
 const guardianIds=(guardians??[]).map((g:{id:string})=>g.id);
 if(!guardianIds.length)return json(403,{error:"This child is not linked to your family account."});
 const {data:link,error:linkError}=await admin.from("student_guardians").select("student_id").eq("school_id",student.school_id).eq("student_id",student.id).in("guardian_id",guardianIds).maybeSingle();
 if(linkError||!link)return json(403,{error:"This child is not linked to your family account."});
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 const token=btoa(String.fromCharCode(...bytes)).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/g,"");
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const tokenHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 const {data:tag,error:insertError}=await admin.from("tags").insert({school_id:student.school_id,student_id:student.id,token_hash:tokenHash,status:"active"}).select("id").single();
 if(insertError||!tag){console.error("parent QR tag insert failed",insertError?.message);return json(500,{error:"The student QR pass could not be prepared. Please refresh and try again."});}
 const {error:revokeError}=await admin.from("tags").update({status:"revoked",revoked_at:new Date().toISOString()}).eq("school_id",student.school_id).eq("student_id",student.id).eq("status","active").neq("id",tag.id);
 if(revokeError){await admin.from("tags").update({status:"revoked",revoked_at:new Date().toISOString()}).eq("id",tag.id);console.error("parent QR previous pass revoke failed",revokeError.message);return json(500,{error:"The previous student pass could not be safely replaced. Please try again."});}
 return json(200,{success:true,token,student:{id:student.id,fullName:student.full_name,className:student.class_name}});
 }catch(error){console.error("parent QR pass failed",error);return json(500,{error:"The student QR pass could not be prepared."});}
});