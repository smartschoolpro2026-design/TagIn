import { useEffect,useMemo,useRef,useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft,Camera,CheckCircle2,LogIn,LogOut,Search,ShieldCheck,UserRound,X } from 'lucide-react';
type Student={id:string;full_name:string;class_name:string|null;level:string|null};
type Event={id:string;student_id:string;event_type:'check_in'|'check_out';created_at:string;collected_by_name:string|null;scanned_by:string};
type Props={client:SupabaseClient;schoolId:string;schoolName:string;actorName:string;canCheckIn:boolean;canCheckOut:boolean;onBack:()=>void;startInScanMode?:boolean};
type DetectedCode={rawValue:string};
type QRDetector={detect:(source:HTMLVideoElement)=>Promise<DetectedCode[]>};
type QRDetectorConstructor=new(options:{formats:string[]})=>QRDetector;
export function AttendanceWorkspace({client,schoolId,schoolName,actorName,canCheckIn,canCheckOut,onBack,startInScanMode=false}:Props){
 const [students,setStudents]=useState<Student[]>([]),[recent,setRecent]=useState<Event[]>([]),[selected,setSelected]=useState<Student|null>(null),[latest,setLatest]=useState<Event|null>(null);
 const [collector,setCollector]=useState(''),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [scanActive,setScanActive]=useState(startInScanMode),[cameraError,setCameraError]=useState('');
 const [pendingPickup,setPendingPickup]=useState<any|null>(null),[pickupBusy,setPickupBusy]=useState(false);
 const [pendingStudentRelease,setPendingStudentRelease]=useState<any|null>(null),[parentCollectorName,setParentCollectorName]=useState('');
 const videoRef=useRef<HTMLVideoElement|null>(null);
 useEffect(()=>{
  if(!scanActive)return;
  let alive=true,frame=0,stream:MediaStream|null=null,detector:QRDetector|null=null,busyFrame=false;
  const Detector=(window as Window & {BarcodeDetector?:QRDetectorConstructor}).BarcodeDetector;
  async function start(){
   if(!Detector){setCameraError('QR scanning is not supported by this browser. Please use an updated Chrome browser on Android.');return;}
   if(!navigator.mediaDevices?.getUserMedia){setCameraError('Camera access requires a secure browser connection. Open TagIn using its HTTPS address.');return;}
   try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    if(!alive){stream.getTracks().forEach(track=>track.stop());return;}
    if(!videoRef.current)return;
    videoRef.current.srcObject=stream;
    await videoRef.current.play();
    detector=new Detector({formats:['qr_code']});
    const scan=async()=>{
     if(!alive||!detector||!videoRef.current||busyFrame)return;
     busyFrame=true;
     try{
      const codes=await detector.detect(videoRef.current);
      if(alive&&codes.length&&codes[0].rawValue){alive=false;setScanActive(false);void resolveScannedCode(codes[0].rawValue);}
     }catch{ /* Ignore transient camera frames and keep scanning. */ }
     finally{busyFrame=false;}
     if(alive)frame=requestAnimationFrame(scan);
    };
    frame=requestAnimationFrame(scan);
   }catch(e){
    setCameraError(e instanceof Error&&e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings and try again.':'The camera could not be opened. Check that no other app is using it.');
   }
  }
  void start();
  return()=>{alive=false;cancelAnimationFrame(frame);stream?.getTracks().forEach(track=>track.stop());if(videoRef.current)videoRef.current.srcObject=null;};
 },[scanActive]);
 async function resolveScannedCode(rawValue:string){
  setCameraError('');setError('');setNotice('');
  let token=rawValue.trim();
  if(token.toUpperCase().startsWith('TAGIN-PICKUP:')){
   const pickupToken=token.slice('TAGIN-PICKUP:'.length).trim();
   if(!pickupToken){setCameraError('This pickup QR is empty.');return;}
   try{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pickupToken));
    const tokenHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data,error:previewError}=await client.rpc('preview_parent_pickup',{p_school_id:schoolId,p_token_hash:tokenHash});
    if(previewError||!data){setCameraError(previewError?.message||'This pickup pass could not be verified.');return;}
    const {data:signed}=await client.storage.from('tagin-pickup-photos').createSignedUrl(data.photo_path,300);
    setPendingPickup({...data,tokenHash,photoUrl:signed?.signedUrl??''});
   }catch{setCameraError('The pickup pass could not be verified. Please try again.');}
   return;
  }
  if(token.toUpperCase().startsWith('TAGIN:'))token=token.slice(6).trim();
  if(!token){setCameraError('This QR code is empty.');return;}
  try{
   const bytes=new TextEncoder().encode(token);
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const tokenHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
   const {data:tag,error:tagError}=await client.from('tags').select('id,student_id').eq('school_id',schoolId).eq('token_hash',tokenHash).eq('status','active').maybeSingle();
   if(tagError||!tag){setCameraError('This QR code is not active for this school. Ask the school administrator to verify the student tag.');return;}
   const {data:student,error:studentError}=await client.from('students').select('id,full_name,class_name,level').eq('id',tag.student_id).eq('school_id',schoolId).eq('active',true).maybeSingle();
   if(studentError||!student){setCameraError('The QR code does not match an active student in this school.');return;}
   setScanActive(false);
   const verifiedStudent=student as Student;
   const {data:pickupData,error:pickupLookupError}=await client.rpc('preview_student_pickup',{p_school_id:schoolId,p_student_id:verifiedStudent.id});
   if(pickupLookupError){setCameraError(pickupLookupError.message||'Pickup authorisation could not be loaded.');return;}
   let photoUrl='';
   if(pickupData?.has_authorized_collector&&pickupData.photo_path){
    const {data:signed}=await client.storage.from('tagin-pickup-photos').createSignedUrl(pickupData.photo_path,300);
    photoUrl=signed?.signedUrl??'';
   }
   await choose(verifiedStudent);
   setParentCollectorName('');
   setPendingStudentRelease({...verifiedStudent,...pickupData,photoUrl});
   setNotice('Student bag tag verified. Confirm who is collecting the child before release.');
  }catch{
   setCameraError('The QR code could not be verified. Please try again.');
  }
 }

 async function confirmStudentRelease(asParent:boolean){
  const pending=pendingStudentRelease;
  if(!pending||pickupBusy)return;
  const collectorName=asParent?parentCollectorName.trim():String(pending.collector_name||'').trim();
  if(!collectorName){setError(asParent?'Enter the parent or guardian’s name.':'The authorised pickup name is missing.');return;}
  setPickupBusy(true);setError('');setNotice('');
  const {data,error:e}=await client.rpc('record_student_checkout',{
   p_school_id:schoolId,p_student_id:pending.id,
   p_collected_by_type:asParent?'parent':'authorised_pickup',
   p_collected_by_name:collectorName,
   p_authorized_collector_id:asParent?null:pending.collector_id
  });
  if(e){setError(e.message||'The child’s release could not be recorded.');}
  else{
   setPendingStudentRelease(null);setParentCollectorName('');
   await choose(pending as Student);
   setNotice(pending.full_name+' has been checked out. Collected by '+collectorName+'.');
   await refreshRecent();
  }
  setPickupBusy(false);
 }
 async function confirmPickupRelease(){
  if(!pendingPickup||pickupBusy)return;
  setPickupBusy(true);setError('');setNotice('');
  const {data,error:e}=await client.rpc('complete_parent_pickup',{p_school_id:schoolId,p_token_hash:pendingPickup.tokenHash});
  if(e){setError(e.message||'The pickup pass could not be completed.');}
  else{
   const releasedName=data?.student_name||pendingPickup.student_name;
   const collectorName=data?.collector_name||pendingPickup.collector_name;
   setPendingPickup(null);
   await choose({id:pendingPickup.student_id,full_name:releasedName,class_name:pendingPickup.class_name??null,level:pendingPickup.level??null});
   setNotice(releasedName+' has been released to '+collectorName+'. The one-time pickup pass is now used.');
   await refreshRecent();
  }
  setPickupBusy(false);
 }
 async function refreshRecent(){const {data}=await client.from('scan_events').select('id,student_id,event_type,created_at,collected_by_name,scanned_by').eq('school_id',schoolId).in('event_type',['check_in','check_out']).order('created_at',{ascending:false}).limit(12);setRecent((data??[]) as Event[]);}
 useEffect(()=>{let alive=true;async function load(){setLoading(true);const [s,e]=await Promise.all([client.from('students').select('id,full_name,class_name,level').eq('school_id',schoolId).eq('active',true).order('full_name'),client.from('scan_events').select('id,student_id,event_type,created_at,collected_by_name,scanned_by').eq('school_id',schoolId).in('event_type',['check_in','check_out']).order('created_at',{ascending:false}).limit(12)]);if(!alive)return;if(s.error)setError('Could not load this school’s student register.');else setStudents((s.data??[]) as Student[]);if(e.error)setError('Attendance history is not available to this account.');else setRecent((e.data??[]) as Event[]);setLoading(false);}void load();return()=>{alive=false;}},[client,schoolId]);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return students.filter(s=>!q||[s.full_name,s.class_name??'',s.level??''].some(v=>v.toLowerCase().includes(q))).slice(0,40)},[students,search]);
 async function choose(s:Student){setSelected(s);setLatest(null);setCollector('');setError('');setNotice('');setChecking(true);const {data,error:e}=await client.from('scan_events').select('id,student_id,event_type,created_at,collected_by_name,scanned_by').eq('school_id',schoolId).eq('student_id',s.id).in('event_type',['check_in','check_out']).order('created_at',{ascending:false}).limit(1).maybeSingle();if(e)setError('Could not verify latest attendance status. No action can be recorded.');else setLatest(data as Event|null);setChecking(false);}
 async function record(action:'check_in'|'check_out'){if(!selected||busy||checking)return;if(action==='check_out'&&!collector.trim()){setError('Enter the name of the person collecting the student.');return;}setBusy(true);setError('');setNotice('');const {data,error:e}=await client.rpc('record_attendance_event',{p_school_id:schoolId,p_student_id:selected.id,p_event_type:action,p_collected_by_name:action==='check_out'?collector.trim():null});if(e){const m=e.message??'';setError(m.includes('already checked in')?'Duplicate prevented: this student is already checked in.':m.includes('does not have an active')?'This student has no active school check-in.':m.includes('not permitted')?'Your account is not permitted to perform this action.':'Attendance could not be recorded. Please try again.');}else{setLatest(data as Event);setCollector('');setNotice(selected.full_name+' has been '+(action==='check_in'?'checked in':'checked out')+' successfully.');await refreshRecent();}setBusy(false);}
 const inside=latest?.event_type==='check_in';
 return <section className="attendance-workspace">
  <div className="attendance-heading"><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">CORE ATTENDANCE · {schoolName}</p><h1>Student check-in &amp; check-out</h1><p className="muted">Find a student, confirm their identity and record their arrival or departure.</p></div>
  {(canCheckIn||canCheckOut)&&<section className="attendance-scan-card">
   <div className="attendance-scan-copy"><span className="attendance-scan-icon"><Camera size={21}/></span><div><h2>Scan student QR code</h2><p>Use your phone camera to identify a student securely. The code is checked against this school’s active tags.</p></div></div>
   {!scanActive?<button className="attendance-scan-button" type="button" onClick={()=>{setCameraError('');setScanActive(true);}}><Camera size={18}/> Open QR scanner</button>:<button className="attendance-scan-close" type="button" onClick={()=>setScanActive(false)}><X size={17}/> Close scanner</button>}
   {scanActive&&<div className="attendance-camera-frame"><video ref={videoRef} autoPlay muted playsInline/><div className="attendance-camera-guide"><span/></div><p>Hold the student’s QR code inside the frame.</p></div>}
   {cameraError&&<p className="form-error" role="alert">{cameraError}</p>}
  {pendingStudentRelease&&<div className="attendance-pickup-verify">
   <div className="attendance-pickup-photo">{pendingStudentRelease.photoUrl?<img src={pendingStudentRelease.photoUrl} alt={pendingStudentRelease.collector_name}/>:<UserRound size={28}/>}</div>
   <div className="attendance-pickup-details">
    <p className="eyebrow">STUDENT BAG TAG VERIFIED</p>
    <h3>{pendingStudentRelease.full_name}</h3>
    {pendingStudentRelease.has_authorized_collector?<><p className="attendance-pickup-warning">PARENT-AUTHORISED PICKUP PERSON</p><p><strong>{pendingStudentRelease.collector_name}</strong>{pendingStudentRelease.relationship?' · '+pendingStudentRelease.relationship:''}</p>{pendingStudentRelease.phone&&<p>Phone: {pendingStudentRelease.phone}</p>}<p>Compare the person at the gate with this photo before confirming release.</p>{!pendingStudentRelease.is_checked_in&&<p className="attendance-pickup-warning">This student is not currently checked in, so collection cannot be recorded.</p>}<button className="attendance-checkout" type="button" disabled={pickupBusy||!pendingStudentRelease.is_checked_in} onClick={()=>void confirmStudentRelease(false)}>{pickupBusy?'Recording release…':'Confirm authorised person collected'}</button></>:<><p className="attendance-pickup-warning">NO ACTIVE PICKUP PERSON ASSIGNED FOR TODAY</p><p>Only release the child to a parent or guardian after checking their identity.</p>{!pendingStudentRelease.is_checked_in&&<p className="attendance-pickup-warning">This student is not currently checked in, so collection cannot be recorded.</p>}</>}
    <label className="collector-field">Parent or guardian’s full name<input value={parentCollectorName} onChange={e=>setParentCollectorName(e.target.value)} placeholder="Enter parent / guardian name" maxLength={160}/></label>
    <button className="attendance-checkin" type="button" disabled={pickupBusy||!parentCollectorName.trim()||!pendingStudentRelease.is_checked_in} onClick={()=>void confirmStudentRelease(true)}>{pickupBusy?'Recording release…':'Confirm parent collected'}</button>
    <button className="attendance-scan-close" type="button" disabled={pickupBusy} onClick={()=>setPendingStudentRelease(null)}>Cancel</button>
   </div>
  </div>}
   {pendingPickup&&<div className="attendance-pickup-verify">
    <div className="attendance-pickup-photo">{pendingPickup.photoUrl?<img src={pendingPickup.photoUrl} alt={pendingPickup.collector_name}/>:<UserRound size={28}/>}</div>
    <div className="attendance-pickup-details"><p className="eyebrow">ONE-TIME PICKUP PASS VERIFIED</p><h3>{pendingPickup.collector_name}</h3><p>Collecting: <strong>{pendingPickup.student_name}</strong></p>{pendingPickup.relationship&&<p>Relationship: {pendingPickup.relationship}</p>}{pendingPickup.phone&&<p>Phone: {pendingPickup.phone}</p>}<p className="attendance-pickup-warning">Check the photo and identity before releasing the student. Confirming will check the child out and permanently use this QR.</p><button className="attendance-checkout" type="button" disabled={pickupBusy} onClick={()=>void confirmPickupRelease()}>{pickupBusy?'Completing release…':'Confirm child release'}</button><button className="attendance-scan-close" type="button" disabled={pickupBusy} onClick={()=>setPendingPickup(null)}>Cancel</button></div>
   </div>}
  </section>}

  <div className="attendance-layout"><div className="attendance-search-panel"><div className="attendance-panel-title"><div><h2>Find a student</h2><p>Search by name, class or level.</p></div><span className="attendance-count">{students.length} active</span></div><label className="attendance-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search student register…"/></label><div className="attendance-student-results">{loading?<p className="attendance-empty">Loading students…</p>:filtered.length===0?<p className="attendance-empty">No matching active students.</p>:filtered.map(s=><button type="button" key={s.id} className={'attendance-student '+(selected?.id===s.id?'selected':'')} onClick={()=>void choose(s)}><span className="attendance-avatar"><UserRound size={18}/></span><span className="attendance-student-copy"><strong>{s.full_name}</strong><small>{s.class_name||'Class not set'}{s.level?' · '+s.level:''}</small></span><span>›</span></button>)}</div></div>
  <div className="attendance-action-panel">{!selected?<div className="attendance-placeholder"><ShieldCheck size={30}/><h2>Select a student</h2><p>The latest attendance state will appear here before an action is recorded.</p></div>:<><div className="attendance-selected-head"><span className="attendance-avatar large"><UserRound size={24}/></span><div><p className="eyebrow">STUDENT IDENTITY</p><h2>{selected.full_name}</h2><p>{selected.class_name||'Class not set'}{selected.level?' · '+selected.level:''}</p></div></div><div className={'attendance-state '+(checking?'pending':inside?'inside':'outside')}>{checking?'Checking latest attendance…':inside?'Currently checked in':latest?'Last action: checked out':'No attendance record yet'}{latest&&!checking?' · '+new Date(latest.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):''}</div>{canCheckOut&&inside&&<div className="collector-field"><label htmlFor="collector-name">Person collecting the student</label><input id="collector-name" value={collector} onChange={e=>setCollector(e.target.value)} placeholder="Parent / authorised collector full name" maxLength={160}/></div>}<div className="attendance-action-buttons">{canCheckIn&&<button className="attendance-checkin" type="button" disabled={busy||checking||inside} onClick={()=>void record('check_in')}><LogIn size={18}/>{busy?'Recording…':'Check student in'}</button>}{canCheckOut&&<button className="attendance-checkout" type="button" disabled={busy||checking||!inside||!collector.trim()} onClick={()=>void record('check_out')}><LogOut size={18}/>{busy?'Recording…':'Check student out'}</button>}</div><p className="attendance-actor">Staff account: <strong>{actorName}</strong></p></>}{error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="student-notice" role="status">{notice}</p>}</div></div>
  <div className="attendance-recent-panel"><div className="student-list-heading"><div><h2>Recent attendance activity</h2><p>Latest school arrival and departure records.</p></div><span>{recent.length} events</span></div>{recent.length===0?<p className="attendance-empty">No attendance activity recorded yet.</p>:<div className="attendance-recent-list">{recent.map(e=>{const s=students.find(x=>x.id===e.student_id);return <div className="attendance-recent-row" key={e.id}><span className={'attendance-event-icon '+e.event_type}><CheckCircle2 size={16}/></span><span className="attendance-recent-copy"><strong>{s?.full_name??'Student record'}</strong><small>{e.event_type==='check_in'?'School check-in':'School check-out · Collected by '+(e.collected_by_name??'Not recorded')}</small></span><time>{new Date(e.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>})}</div>}</div>
  <p className="attendance-footnote">Every action is attributed to the signed-in staff account. Bus journeys remain separate from school attendance.</p>
 </section>;
}