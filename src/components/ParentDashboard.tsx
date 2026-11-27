import { useEffect,useMemo,useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Award,Bell,BookOpen,BusFront,CalendarDays,ChevronDown,GraduationCap,HeartHandshake,School,ShieldCheck } from 'lucide-react';

type Child={id:string;full_name:string;class_name:string|null;level:string|null;school:string;schoolId:string};
type Props={client:SupabaseClient;userId:string;parentName:string;onOpen:(view:'scores-parent'|'timetable-parent'|'family')=>void};
export function ParentDashboard({client,userId,parentName,onOpen}:Props){
 const [children,setChildren]=useState<Child[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{let alive=true;async function load(){
  setLoading(true);setError('');
  const {data,error:e}=await client.from('guardians').select('school_id,schools(name),student_guardians(student_id,students(id,full_name,class_name,level,active))').eq('user_id',userId);
  if(!alive)return;
  if(e){setError('Your linked children could not be loaded. Please refresh or contact your school.');setChildren([]);}
  else{
   const rows=(data??[]) as any[];
   const items:Child[]=rows.flatMap(g=>(g.student_guardians??[]).map((link:any)=>link.students).filter((s:any)=>s?.id&&s.active!==false).map((s:any)=>({id:s.id,full_name:s.full_name,class_name:s.class_name,level:s.level,school:g.schools?.name??'Your school',schoolId:g.school_id})));
   const unique=Array.from(new Map(items.map(x=>[x.id,x])).values());
   setChildren(unique);setSelectedId(old=>unique.some(x=>x.id===old)?old:unique[0]?.id??'');
  }
  setLoading(false);
 }void load();return()=>{alive=false;};},[client,userId]);
 const child=useMemo(()=>children.find(x=>x.id===selectedId)??children[0],[children,selectedId]);
 const menu=[
  {title:'Children’s results',description:'Published scores and teacher remarks',icon:<Award size={20}/>,action:()=>onOpen('scores-parent')},
  {title:'Children’s timetable',description:'Weekly class schedule',icon:<CalendarDays size={20}/>,action:()=>onOpen('timetable-parent')},
  {title:'Family updates',description:'Attendance, arrival and departure notices',icon:<Bell size={20}/>,action:()=>onOpen('family')},
  {title:'Transport updates',description:'School bus pickup and drop-off updates',icon:<BusFront size={20}/>,action:()=>onOpen('family')},
 ];
 return <main className="parent-dashboard">
  <section className="parent-welcome"><div><p className="eyebrow">YOUR FAMILY PORTAL</p><h1>Hello, {parentName.trim().split(/\\s+/)[0]||'there'}.</h1><p>Welcome back to TagIn.</p></div><div className="parent-welcome-mark"><GraduationCap size={30}/></div></section>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {loading?<div className="parent-panel parent-loading">Loading your children…</div>:!child?<div className="parent-panel parent-empty"><HeartHandshake size={28}/><strong>No children linked yet</strong><p>Ask your child’s school to link your account to a student record.</p></div>:<>
   <section className="parent-school-strip"><span><School size={17}/></span><div><small>SCHOOL</small><strong>{child.school}</strong></div></section>
   <section className="parent-child-panel"><div className="parent-child-heading"><div><p className="eyebrow">STUDENT WORKSPACE</p><h2>{child.full_name}</h2><p>{child.class_name??child.level??'Student'}</p></div>{children.length>1&&<label className="parent-child-select"><span>Child</span><select value={child.id} onChange={e=>setSelectedId(e.target.value)}>{children.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select><ChevronDown size={15}/></label>}</div>
    <div className="parent-qr-panel"><div className="parent-qr-placeholder"><ShieldCheck size={34}/></div><div><strong>Student QR pass</strong><p>The student’s issued QR credential will appear here for authorised school staff to scan.</p><span>QR pass display is being connected securely to the school-issued tag.</span></div></div>
   </section>
  </>}
  <section className="parent-menu-section"><p className="eyebrow">YOUR CHILD’S INFORMATION</p><h2>Explore</h2><div className="parent-menu-grid">{menu.map(item=><button type="button" className="parent-menu-item" key={item.title} onClick={item.action}><span className="parent-menu-icon">{item.icon}</span><span className="parent-menu-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="parent-menu-arrow">›</span></button>)}</div></section>
  <p className="parent-dashboard-foot">Your child’s information is private to your linked family account.</p>
 </main>;
}
