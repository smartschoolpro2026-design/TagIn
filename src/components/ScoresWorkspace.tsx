import {useEffect,useMemo,useState,type FormEvent} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ArrowLeft,Award,BookOpen,ClipboardList,Plus,Save} from 'lucide-react';
type Assessment={id:string;school_id:string;class_name:string;subject_name:string;assessment_name:string;assessment_type:string;academic_year:string;term:string;max_score:number;teacher_membership_id:string|null;status:'draft'|'published'|'closed';assessment_date:string|null};
type Student={id:string;full_name:string;class_name:string|null};
type Teacher={id:string;profiles:{full_name:string}|null};
type Score={student_id:string;score:number|string;remarks:string|null};
type Props={client:SupabaseClient;schoolId:string;schoolName:string;mode:'admin'|'teacher'|'parent';membershipId?:string;userId?:string;onBack:()=>void};
export function ScoresWorkspace({client,schoolId,schoolName,mode,membershipId,userId,onBack}:Props){
 const [assessments,setAssessments]=useState<Assessment[]>([]),[students,setStudents]=useState<Student[]>([]),[teachers,setTeachers]=useState<Teacher[]>([]),[children,setChildren]=useState<Student[]>([]),[scores,setScores]=useState<Record<string,Score>>({}),[drafts,setDrafts]=useState<Record<string,{score:string;remarks:string}>>({});
 const [selectedId,setSelectedId]=useState(''),[className,setClassName]=useState(''),[subject,setSubject]=useState(''),[name,setName]=useState(''),[kind,setKind]=useState('test'),[year,setYear]=useState('2026/2027'),[term,setTerm]=useState('First term'),[max,setMax]=useState('100'),[teacher,setTeacher]=useState(''),[date,setDate]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const selected=assessments.find(a=>a.id===selectedId)??null;
 async function load(){
  setLoading(true);setError('');
  if(mode==='parent'){
   const {data:links,error:e}=await client.from('student_guardians').select('student:students(id,full_name,class_name)').eq('school_id',schoolId);
   if(e){setError('Linked students could not be loaded.');setLoading(false);return;}
   const kids=(links??[]).map((x:any)=>x.student).filter((x:any)=>x?.id) as Student[];setChildren(kids);
   const classes=[...new Set(kids.map(x=>x.class_name).filter((x):x is string=>!!x))];
   if(!classes.length){setAssessments([]);setLoading(false);return;}
   const {data,error:e2}=await client.from('assessments').select('*').eq('school_id',schoolId).eq('status','published').in('class_name',classes).order('assessment_date',{ascending:false});
   if(e2)setError('Published results could not be loaded.');else{setAssessments((data??[]) as Assessment[]);setSelectedId(old=>data?.some(x=>x.id===old)?old:data?.[0]?.id??'');}
  }else{
   let q=client.from('assessments').select('*').eq('school_id',schoolId).order('created_at',{ascending:false});if(mode==='teacher'&&membershipId)q=q.eq('teacher_membership_id',membershipId);
   const {data,error:e}=await q;if(e)setError('Assessments could not be loaded.');else{setAssessments((data??[]) as Assessment[]);setSelectedId(old=>data?.some(x=>x.id===old)?old:data?.[0]?.id??'');}
   if(mode==='admin'){const {data:t}=await client.from('school_memberships').select('id,profiles(full_name)').eq('school_id',schoolId).eq('role','staff').eq('status','active');setTeachers((t??[]) as unknown as Teacher[]);}
  }
  setLoading(false);
 }
 useEffect(()=>{void load();},[client,schoolId,mode,membershipId]);
 useEffect(()=>{if(!selected)return;let alive=true;async function get(){
  setScores({});setDrafts({});
  const [sc,st]=await Promise.all([
   client.from('assessment_scores').select('student_id,score,remarks').eq('assessment_id',selected.id).eq('school_id',schoolId),
   mode==='parent'?Promise.resolve({data:children.filter(x=>x.class_name===selected.class_name),error:null} as any):client.from('students').select('id,full_name,class_name').eq('school_id',schoolId).eq('class_name',selected.class_name).eq('active',true).order('full_name')
  ]);
  if(!alive)return;
  if(sc.error)setError('Scores could not be loaded.');else{const m:Record<string,Score>={},d:Record<string,{score:string;remarks:string}>={};(sc.data??[]).forEach((x:any)=>{m[x.student_id]=x;d[x.student_id]={score:String(x.score),remarks:x.remarks??''};});setScores(m);setDrafts(d);}
  if(st.error)setError('Class students could not be loaded.');else setStudents((st.data??[]) as Student[]);
 }void get();return()=>{alive=false;};},[client,selectedId,schoolId,mode,children]);
 const stats=useMemo(()=>({entered:Object.keys(scores).length,total:students.length}),[scores,students]);
 async function create(e:FormEvent){e.preventDefault();setSaving(true);setError('');setNotice('');
  const {data,error:e2}=await client.from('assessments').insert({school_id:schoolId,class_name:className.trim(),subject_name:subject.trim(),assessment_name:name.trim(),assessment_type:kind,academic_year:year.trim(),term,max_score:Number(max),teacher_membership_id:teacher||null,assessment_date:date||null,created_by:userId??null}).select('id').single();
  if(e2)setError('Could not create assessment. Check the maximum score and teacher assignment.');else{setName('');setSubject('');setTeacher('');setDate('');setNotice('Draft assessment created.');await load();if(data?.id)setSelectedId(data.id);}setSaving(false);
 }
 async function save(student:Student){if(!selected)return;const d=drafts[student.id];const n=Number(d?.score);if(!d?.score.trim()||!Number.isFinite(n)||n<0||n>Number(selected.max_score)){setError('Enter a score between 0 and '+selected.max_score+'.');return;}
  setSaving(true);setError('');const {data,error:e}=await client.from('assessment_scores').upsert({school_id:schoolId,assessment_id:selected.id,student_id:student.id,score:n,remarks:d.remarks.trim()||null,entered_by:userId??null},{onConflict:'assessment_id,student_id'}).select('student_id,score,remarks').single();
  if(e)setError('Score could not be saved. Check your assignment and the maximum score.');else{setScores(old=>({...old,[student.id]:data as Score}));setNotice('Score saved for '+student.full_name+'.');}setSaving(false);
 }
 async function status(next:'published'|'closed'|'draft'){if(!selected)return;setSaving(true);const {error:e}=await client.from('assessments').update({status:next}).eq('id',selected.id).eq('school_id',schoolId);if(e)setError('Assessment status could not be changed.');else{setNotice(next==='published'?'Results published for linked parents.':'Assessment status updated.');await load();}setSaving(false);}
 return <section className="scores-workspace">
  <div className="scores-heading"><div><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">{mode==='admin'?'ACADEMIC OPERATIONS':mode==='teacher'?'TEACHER WORKSPACE':'FAMILY PORTAL'} · {schoolName}</p><h1>{mode==='admin'?'Scores & assessments':mode==='teacher'?'My assessments':'My children’s results'}</h1><p className="muted">{mode==='admin'?'Create assessments, enter scores and publish results.':mode==='teacher'?'Enter scores for assessments assigned to you.':'View published results for your linked children.'}</p></div><div className="scores-icon"><Award size={27}/></div></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="student-notice" role="status">{notice}</p>}
  {mode==='admin'&&<form className="scores-create" onSubmit={create}><div><p className="eyebrow">ASSESSMENT BUILDER</p><h2><Plus size={18}/> Create assessment</h2></div><div className="scores-form-grid">
   <label>Class<input value={className} onChange={e=>setClassName(e.target.value)} placeholder="e.g. JSS 1A" required maxLength={80}/></label><label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Mathematics" required maxLength={100}/></label><label>Assessment name<input value={name} onChange={e=>setName(e.target.value)} placeholder="First CA" required maxLength={120}/></label>
   <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="classwork">Classwork</option><option value="test">Test</option><option value="exam">Exam</option><option value="project">Project</option><option value="other">Other</option></select></label>
   <label>Academic year<input value={year} onChange={e=>setYear(e.target.value)} required maxLength={20}/></label><label>Term<select value={term} onChange={e=>setTerm(e.target.value)}><option>First term</option><option>Second term</option><option>Third term</option></select></label>
   <label>Maximum score<input type="number" min="1" max="100000" step="0.01" value={max} onChange={e=>setMax(e.target.value)} required/></label><label>Assign teacher<select value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">Choose teacher</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.profiles?.full_name??'Teacher'}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  </div><button className="primary-button" disabled={saving}>{saving?'Saving…':'Create draft assessment'} <Plus size={15}/></button></form>}
  <div className="scores-panel"><div className="scores-panel-head"><div><h2><ClipboardList size={18}/> Assessments</h2><p>{assessments.length} available</p></div><select aria-label="Choose assessment" value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">Select assessment</option>{assessments.map(a=><option key={a.id} value={a.id}>{a.class_name} · {a.subject_name} · {a.assessment_name}</option>)}</select></div>
   {loading?<p className="scores-empty">Loading assessments…</p>:!selected?<div className="scores-empty"><BookOpen size={26}/><strong>No assessments available</strong><span>{mode==='admin'?'Create your first assessment above.':mode==='teacher'?'Ask your school administrator to assign an assessment.':'Published results will appear here when available.'}</span></div>:<>
    <div className="scores-selected"><div><span>{selected.class_name} · {selected.subject_name}</span><h3>{selected.assessment_name}</h3><p>{selected.assessment_type} · {selected.term} · {selected.academic_year} · Out of {selected.max_score}</p></div><span className={'scores-status '+selected.status}>{selected.status}</span></div>
    {mode==='admin'&&<div className="scores-actions">{selected.status!=='published'&&<button type="button" className="primary-button" disabled={saving} onClick={()=>void status('published')}>Publish results</button>}{selected.status!=='closed'&&<button type="button" className="scores-secondary" disabled={saving} onClick={()=>void status('closed')}>Close assessment</button>}{selected.status==='published'&&<button type="button" className="scores-secondary" disabled={saving} onClick={()=>void status('draft')}>Unpublish</button>}</div>}
    <div className="scores-progress"><span>{mode==='parent'?'Published marks':'Scores entered'}</span><strong>{stats.entered}{mode==='parent'?'':' / '+stats.total}</strong></div>
    <div className="scores-list">{students.length===0?<p className="scores-empty">No students found for this class.</p>:students.map(student=>{const existing=scores[student.id],d=drafts[student.id]??{score:'',remarks:''};return <article className="scores-row" key={student.id}><div className="scores-student"><strong>{student.full_name}</strong><span>{student.class_name??selected.class_name}</span></div>{mode==='parent'?<div className="scores-parent-mark"><strong>{existing?String(existing.score)+' / '+String(selected.max_score):'Not recorded'}</strong>{existing?.remarks&&<span>{existing.remarks}</span>}</div>:<div className="scores-entry"><label>Score<input type="number" min="0" max={selected.max_score} step="0.01" value={d.score} disabled={selected.status==='closed'||(mode==='teacher'&&selected.status!=='draft')} onChange={e=>setDrafts(old=>({...old,[student.id]:{...d,score:e.target.value}}))}/></label><label>Remark<input value={d.remarks} disabled={selected.status==='closed'||(mode==='teacher'&&selected.status!=='draft')} placeholder="Optional" onChange={e=>setDrafts(old=>({...old,[student.id]:{...d,remarks:e.target.value}}))}/></label><button type="button" className="scores-save" disabled={saving||selected.status==='closed'||(mode==='teacher'&&selected.status!=='draft')||!d.score.trim()} onClick={()=>void save(student)}><Save size={15}/> Save</button></div>}</article>;})}</div>
   </>}
  </div><p className="scores-footnote">Scores are checked against the maximum. Parents see published results for linked children only.</p>
 </section>;
}
