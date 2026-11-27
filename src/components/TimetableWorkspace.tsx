import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, CalendarDays, Clock3, GraduationCap, Plus, UserRound } from 'lucide-react';

type Entry={id:string;class_name:string;subject_name:string;teacher_membership_id:string|null;weekday:number;start_time:string;end_time:string;room:string|null;notes:string|null;active:boolean;school_id:string};
type Teacher={id:string;profiles:{full_name:string}|null};
type Student={id:string;class_name:string|null};
type Props={client:SupabaseClient;schoolId:string;schoolName:string;mode:'admin'|'teacher'|'parent';membershipId?:string;userId?:string;onBack:()=>void};
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const timeLabel=(v:string)=>v.slice(0,5);
export function TimetableWorkspace({client,schoolId,schoolName,mode,membershipId,userId,onBack}:Props){
 const [entries,setEntries]=useState<Entry[]>([]),[teachers,setTeachers]=useState<Teacher[]>([]),[classes,setClasses]=useState<string[]>([]);
 const [selectedDay,setSelectedDay]=useState(1),[selectedClass,setSelectedClass]=useState(''),[subject,setSubject]=useState(''),[className,setClassName]=useState(''),[teacherId,setTeacherId]=useState(''),[weekday,setWeekday]=useState('1'),[start,setStart]=useState('08:00'),[end,setEnd]=useState('09:00'),[room,setRoom]=useState(''),[notes,setNotes]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){
  setLoading(true);setError('');
  const [e,t,s]=await Promise.all([
   client.from('timetable_entries').select('id,school_id,class_name,subject_name,teacher_membership_id,weekday,start_time,end_time,room,notes,active').eq('school_id',schoolId).eq('active',true).order('weekday').order('start_time'),
   mode==='admin'?client.from('school_memberships').select('id,profiles(full_name)').eq('school_id',schoolId).eq('role','staff').eq('status','active'):Promise.resolve({data:[],error:null} as any),
   mode==='admin'?client.from('students').select('id,class_name').eq('school_id',schoolId).eq('active',true):Promise.resolve({data:[],error:null} as any)
  ]);
  if(e.error){setError('Timetable could not be loaded. Confirm your school access is active.');setEntries([]);}
  else setEntries((e.data??[]) as unknown as Entry[]);
  if(mode==='admin'){if(t.error)setError('Teacher list could not be loaded.');else setTeachers((t.data??[]) as unknown as Teacher[]);if(s.error)setError('Class list could not be loaded.');else {const classNames: string[]=(s.data??[]).map((x:Student)=>x.class_name).filter((x):x is string=>typeof x==='string'&&x.trim().length>0);setClasses([...new Set<string>(classNames)].sort());}}
  setLoading(false);
 }
 useEffect(()=>{void load();},[client,schoolId,mode,membershipId,userId]);
 const visible=useMemo(()=>entries.filter(e=>e.weekday===selectedDay&&(mode!=='admin'||!selectedClass||e.class_name===selectedClass)),[entries,selectedDay,selectedClass,mode]);
 async function addEntry(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');
  const {error:err}=await client.from('timetable_entries').insert({school_id:schoolId,class_name:className.trim(),subject_name:subject.trim(),teacher_membership_id:teacherId||null,weekday:Number(weekday),start_time:start,end_time:end,room:room.trim()||null,notes:notes.trim()||null,created_by:userId??null});
  if(err)setError(err.code==='23505'?'This class already has an entry starting at that time.':'Timetable entry could not be saved. Check the class and times.');
  else{setSubject('');setTeacherId('');setRoom('');setNotes('');setNotice('Lesson added to the timetable.');await load();}
  setBusy(false);
 }
 async function deactivate(id:string){setBusy(true);setError('');const {error:err}=await client.from('timetable_entries').update({active:false}).eq('id',id).eq('school_id',schoolId);if(err)setError('Could not remove this timetable entry.');else{setNotice('Lesson removed.');await load();}setBusy(false);}
 const title=mode==='admin'?'Timetable management':mode==='teacher'?'My teaching timetable':'Class timetable';
 return <section className="timetable-workspace">
  <div className="timetable-heading"><div><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">{mode==='admin'?'ACADEMIC OPERATIONS':mode==='teacher'?'TEACHER WORKSPACE':'FAMILY PORTAL'} · {schoolName}</p><h1>{title}</h1><p className="muted">{mode==='admin'?'Build class schedules and assign teachers.':mode==='teacher'?'Lessons assigned to your teacher account.':'Lessons for your linked children’s classes.'}</p></div><div className="timetable-icon"><CalendarDays size={27}/></div></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="student-notice" role="status">{notice}</p>}
  {mode==='admin'&&<form className="timetable-create" onSubmit={addEntry}><div><p className="eyebrow">SCHEDULE BUILDER</p><h2><Plus size={18}/> Add a lesson</h2></div><div className="timetable-form-grid">
   <label>Class<input list="timetable-classes" value={className} onChange={e=>setClassName(e.target.value)} placeholder="e.g. JSS 1A" required maxLength={80}/><datalist id="timetable-classes">{classes.map(c=><option key={c} value={c}/>)}</datalist></label>
   <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g. Mathematics" required maxLength={100}/></label>
   <label>Teacher<select value={teacherId} onChange={e=>setTeacherId(e.target.value)}><option value="">Not assigned</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.profiles?.full_name??'Teacher'}</option>)}</select></label>
   <label>Day<select value={weekday} onChange={e=>setWeekday(e.target.value)}>{days.map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label>
   <label>Start time<input type="time" value={start} onChange={e=>setStart(e.target.value)} required/></label><label>End time<input type="time" value={end} onChange={e=>setEnd(e.target.value)} required min={start}/></label>
   <label>Room (optional)<input value={room} onChange={e=>setRoom(e.target.value)} placeholder="e.g. Science Lab" maxLength={80}/></label>
   <label>Notes (optional)<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Lesson notes" maxLength={300}/></label>
  </div><button className="primary-button" disabled={busy}>{busy?'Saving…':'Add to timetable'} <Plus size={15}/></button></form>}
  <div className="timetable-panel"><div className="timetable-panel-head"><div><h2><Clock3 size={18}/> Weekly schedule</h2><p>{mode==='admin'?'Select a class and day to review its lessons.':'Choose a day to view scheduled lessons.'}</p></div>{mode==='admin'&&<select aria-label="Filter class" value={selectedClass} onChange={e=>setSelectedClass(e.target.value)}><option value="">All classes</option>{classes.map(c=><option key={c}>{c}</option>)}</select>}</div>
   <div className="timetable-days">{days.map((d,i)=><button key={d} type="button" className={selectedDay===i+1?'active':''} onClick={()=>setSelectedDay(i+1)}>{d.slice(0,3)}</button>)}</div>
   {loading?<p className="timetable-empty">Loading timetable…</p>:visible.length===0?<div className="timetable-empty"><CalendarDays size={25}/><strong>No lessons scheduled</strong><span>{mode==='admin'?'Add a lesson to start building this class timetable.':'There are no published lessons for this day.'}</span></div>:<div className="timetable-list">{visible.map(item=><article className="timetable-entry" key={item.id}><div className="timetable-time"><strong>{timeLabel(item.start_time)}</strong><span>{timeLabel(item.end_time)}</span></div><div className="timetable-entry-main"><strong>{item.subject_name}</strong><span>{item.class_name}{item.room?' · '+item.room:''}</span><small>{mode==='admin'?(teachers.find(t=>t.id===item.teacher_membership_id)?.profiles?.full_name??(item.teacher_membership_id?'Teacher assigned':'Teacher not assigned')):mode==='teacher'?'Assigned to you':item.teacher_membership_id?'Teacher assigned':'Teacher not assigned'}{item.notes?' · '+item.notes:''}</small></div>{mode==='admin'&&<button className="timetable-remove" type="button" disabled={busy} onClick={()=>void deactivate(item.id)}>Remove</button>}</article>)}</div>}
  </div>
  {mode==='admin'&&<p className="timetable-footnote"><GraduationCap size={14}/> Lessons are retained when removed; they are marked inactive rather than deleted.</p>}
  {mode==='teacher'&&<p className="timetable-footnote"><UserRound size={14}/> Only lessons assigned to your active school membership are shown.</p>}
  {mode==='parent'&&<p className="timetable-footnote"><BookOpen size={14}/> Timetables are read-only and limited to the classes of your linked children.</p>}
 </section>;
}
