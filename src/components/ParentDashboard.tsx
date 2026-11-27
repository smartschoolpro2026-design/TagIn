import { useEffect,useMemo,useRef,useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
type QRCodeConstructor={new(element:HTMLElement,options:{text:string;width:number;height:number;colorDark:string;colorLight:string;correctLevel:number}):unknown;CorrectLevel?:{M:number}};
declare global { interface Window { QRCode?:QRCodeConstructor } }
import { Award,Bell,BusFront,CalendarDays,ChevronDown,GraduationCap,HeartHandshake,School,ShieldCheck } from 'lucide-react';

type Child={id:string;full_name:string;class_name:string|null;level:string|null;school:string;schoolId:string};
type Props={client:SupabaseClient;userId:string;parentName:string;onOpen:(view:'scores-parent'|'timetable-parent'|'family')=>void};
export function ParentDashboard({client,userId,parentName,onOpen}:Props){
 const [children,setChildren]=useState<Child[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [qrToken,setQrToken]=useState('');
 const [qrLoading,setQrLoading]=useState(false);
 const [qrError,setQrError]=useState('');
 const qrTarget=useRef<HTMLDivElement|null>(null);
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
 useEffect(()=>{if(!child?.id){setQrToken('');return;}let alive=true;async function issuePass(){setQrLoading(true);setQrError('');setQrToken('');const {data,error:e}=await client.functions.invoke('parent-student-qr',{body:{studentId:child.id}});if(!alive)return;if(e||!data?.success||typeof data.token!=='string')setQrError(data?.error||'The student QR pass could not be loaded. Please refresh.');else setQrToken(data.token);setQrLoading(false);}void issuePass();return()=>{alive=false;};},[client,child?.id]);
 useEffect(()=>{if(!qrToken||!qrTarget.current)return;qrTarget.current.innerHTML='';if(!window.QRCode){setQrError('The QR display could not load. Please refresh.');return;}try{new window.QRCode(qrTarget.current,{text:'TAGIN:'+qrToken,width:240,height:240,colorDark:'#123f30',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel?.M??0});}catch{setQrError('The student QR code could not be displayed.');}return()=>{if(qrTarget.current)qrTarget.current.innerHTML='';};},[qrToken]);
 const menu=[
  {title:'Children’s results',description:'Published scores and teacher remarks',icon:<Award size={20}/>,action:()=>onOpen('scores-parent')},
  {title:'Children’s timetable',description:'Weekly class schedule',icon:<CalendarDays size={20}/>,action:()=>onOpen('timetable-parent')},
  {title:'Family updates',description:'Attendance, arrival and departure notices',icon:<Bell size={20}/>,action:()=>onOpen('family')},
  {title:'Transport updates',description:'School bus pickup and drop-off updates',icon:<BusFront size={20}/>,action:()=>onOpen('family')},
 ];
 return <main className="parent-dashboard">
  <section className="parent-welcome"><div><p className="eyebrow">YOUR FAMILY PORTAL</p><h1>Hello, {parentName.trim().split(/\s+/)[0]||'there'}.</h1><p>Welcome back to TagIn.</p></div><div className="parent-welcome-mark"><GraduationCap size={30}/></div></section>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {loading?<div className="parent-panel parent-loading">Loading your children…</div>:!child?<div className="parent-panel parent-empty"><HeartHandshake size={28}/><strong>No children linked yet</strong><p>Ask your child’s school to link your account to a student record.</p></div>:<>
   <section className="parent-school-strip"><span><School size={17}/></span><div><small>SCHOOL</small><strong>{child.school}</strong></div></section>
   <section className="parent-child-panel"><div className="parent-child-heading"><div><p className="eyebrow">STUDENT WORKSPACE</p><h2>{child.full_name}</h2><p>{child.class_name??child.level??'Student'}</p></div>{children.length>1&&<label className="parent-child-select"><span>Child</span><select value={child.id} onChange={e=>setSelectedId(e.target.value)}>{children.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select><ChevronDown size={15}/></label>}</div>
    <div className="parent-qr-panel parent-qr-live"><div className="parent-qr-display">{qrToken?<div ref={qrTarget} className="parent-qr-code"/>:<div className="parent-qr-placeholder"><ShieldCheck size={34}/></div>}</div><div><strong>Student QR pass</strong><p>Show this code to authorised school staff when your child arrives or is collected.</p>{qrLoading&&<span>Preparing your child’s secure pass…</span>}{qrError&&<span className="parent-qr-error" role="alert">{qrError}</span>}{qrToken&&!qrError&&<span>Active student pass · Ready to scan</span>}</div></div>
   </section>
  </>}
  <section className="parent-menu-section"><p className="eyebrow">YOUR CHILD’S INFORMATION</p><h2>Explore</h2><div className="parent-menu-grid">{menu.map(item=><button type="button" className="parent-menu-item" key={item.title} onClick={item.action}><span className="parent-menu-icon">{item.icon}</span><span className="parent-menu-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="parent-menu-arrow">›</span></button>)}</div></section>
  <p className="parent-dashboard-foot">Your child’s information is private to your linked family account.</p>
 </main>;
}
