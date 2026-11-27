import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BusFront, Camera, CheckCircle2, Clock3, MapPin, Plus, Route, ShieldCheck, Users, X } from 'lucide-react';

type Vehicle = { id: string; registration_number: string; vehicle_name: string | null; capacity: number; active: boolean };
type Stop = { id: string; route_id: string; stop_name: string; stop_order: number; scheduled_time: string | null };
type RouteRow = { id: string; name: string; direction: string; vehicle_id: string | null; active: boolean; transport_vehicles?: Vehicle | null };
type Driver = { id: string; user_id: string; profiles: { full_name: string } | null };
type Student = { id: string; full_name: string; class_name: string | null; active: boolean };
type RouteStudent = { id: string; student_id: string; pickup_stop_id: string | null; dropoff_stop_id: string | null; students: Student | null };
type EventRow = { id: string; student_id: string; event_type: string; created_at: string; note: string | null; students?: Student | null };
type Props = { client: SupabaseClient; schoolId: string; schoolName: string; mode: 'admin' | 'driver'; membershipId?: string; onBack: () => void };
type DetectedCode = { rawValue: string };
type QRDetector = { detect: (source: HTMLVideoElement) => Promise<DetectedCode[]> };
type QRDetectorConstructor = new (options: { formats: string[] }) => QRDetector;
const stamp = (v: string) => new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function TransportWorkspace({ client, schoolId, schoolName, mode, membershipId, onBack }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<RouteStudent[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [registration, setRegistration] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [capacity, setCapacity] = useState('18');
  const [routeName, setRouteName] = useState('');
  const [direction, setDirection] = useState('both');
  const [vehicleId, setVehicleId] = useState('');
  const [stopName, setStopName] = useState('');
  const [stopTime, setStopTime] = useState('');
  const [driverId, setDriverId] = useState('');
  const [assistantId, setAssistantId] = useState('');
  const [scanActive, setScanActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [studentId, setStudentId] = useState('');
  const [pickupStopId, setPickupStopId] = useState('');
  const [dropoffStopId, setDropoffStopId] = useState('');
  const [note, setNote] = useState('');

  async function loadAdmin() {
    const [v, r, s, d, st, e] = await Promise.all([
      client.from('transport_vehicles').select('id,registration_number,vehicle_name,capacity,active').eq('school_id', schoolId).order('registration_number'),
      client.from('transport_routes').select('id,name,direction,vehicle_id,active,transport_vehicles(id,registration_number,vehicle_name,capacity,active)').eq('school_id', schoolId).order('name'),
      client.from('transport_stops').select('id,route_id,stop_name,stop_order,scheduled_time').eq('school_id', schoolId).order('stop_order'),
      client.from('school_memberships').select('id,user_id,profiles(full_name)').eq('school_id', schoolId).eq('role', 'bus_staff').eq('status', 'active'),
      client.from('students').select('id,full_name,class_name,active').eq('school_id', schoolId).eq('active', true).order('full_name'),
      client.from('transport_events').select('id,student_id,event_type,created_at,note,students(id,full_name,class_name,active)').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(30),
    ]);
    if (v.error || r.error || s.error || d.error || st.error || e.error) setError('Transport records could not be loaded. Check that your school administrator access is active.');
    else {
      setVehicles((v.data ?? []) as Vehicle[]);
      setRoutes((r.data ?? []) as unknown as RouteRow[]);
      setStops((s.data ?? []) as Stop[]);
      setDrivers((d.data ?? []) as unknown as Driver[]);
      setStudents((st.data ?? []) as Student[]);
      setEvents((e.data ?? []) as unknown as EventRow[]);
      if (!selectedRoute && r.data?.[0]) setSelectedRoute(r.data[0].id);
    }
    setLoading(false);
  }

  async function loadDriver() {
    if (!membershipId) { setError('Your driver membership could not be identified. Sign out and back in.'); setLoading(false); return; }
    const { data, error: queryError } = await client.from('transport_route_drivers')
      .select('route_id,transport_routes(id,name,direction,vehicle_id,active,transport_vehicles(id,registration_number,vehicle_name,capacity,active))')
      .eq('school_id', schoolId).eq('membership_id', membershipId).eq('active', true);
    if (queryError) setError('Your assigned journeys could not be loaded. Contact the school administrator.');
    else {
      const assigned = (data ?? []).map((x: any) => x.transport_routes).filter(Boolean) as RouteRow[];
      setRoutes(assigned);
      if (!selectedRoute && assigned[0]) setSelectedRoute(assigned[0].id);
    }
    setLoading(false);
  }

  async function loadAssignments(routeId: string) {
    if (!routeId) { setAssignments([]); setStops([]); setEvents([]); return; }
    const [a, s, e] = await Promise.all([
      client.from('transport_route_students').select('id,student_id,pickup_stop_id,dropoff_stop_id,students(id,full_name,class_name,active)').eq('school_id', schoolId).eq('route_id', routeId).eq('active', true),
      client.from('transport_stops').select('id,route_id,stop_name,stop_order,scheduled_time').eq('school_id', schoolId).eq('route_id', routeId).order('stop_order'),
      client.from('transport_events').select('id,student_id,event_type,created_at,note').eq('school_id', schoolId).eq('route_id', routeId).order('created_at', { ascending: false }).limit(100),
    ]);
    if (a.error || s.error || e.error) setError('Journey details could not be loaded.');
    else { setAssignments((a.data ?? []) as unknown as RouteStudent[]); setStops((s.data ?? []) as Stop[]); setEvents((e.data ?? []) as EventRow[]); }
  }

  useEffect(() => { let alive = true; setLoading(true); (async () => { await (mode === 'admin' ? loadAdmin() : loadDriver()); if (!alive) return; })(); return () => { alive = false; }; }, [client, schoolId, mode, membershipId]);
  useEffect(() => { if (mode === 'driver' || selectedRoute) void loadAssignments(selectedRoute); }, [selectedRoute, mode, schoolId]);

  const activeRoute = routes.find((r) => r.id === selectedRoute);
  const routeStops = useMemo(() => stops.filter((s) => s.route_id === selectedRoute), [stops, selectedRoute]);

  async function saveVehicle(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const { error: err } = await client.from('transport_vehicles').insert({ school_id: schoolId, registration_number: registration.trim().toUpperCase(), vehicle_name: vehicleName.trim() || null, capacity: Number(capacity) });
    if (err) setError(err.code === '23505' ? 'That vehicle registration is already registered.' : 'Vehicle could not be saved. Check the details.');
    else { setRegistration(''); setVehicleName(''); setNotice('Vehicle added.'); await loadAdmin(); }
    setBusy(false);
  }
  async function saveRoute(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const { error: err } = await client.from('transport_routes').insert({ school_id: schoolId, name: routeName.trim(), direction, vehicle_id: vehicleId || null });
    if (err) setError('Route could not be saved. Check the details and selected vehicle.');
    else { setRouteName(''); setNotice('Route created.'); await loadAdmin(); }
    setBusy(false);
  }
  async function saveStop(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const { error: err } = await client.from('transport_stops').insert({ school_id: schoolId, route_id: selectedRoute, stop_name: stopName.trim(), stop_order: routeStops.length + 1, scheduled_time: stopTime || null });
    if (err) setError('Stop could not be saved. Please try again.');
    else { setStopName(''); setStopTime(''); setNotice('Stop added to this route.'); await loadAdmin(); await loadAssignments(selectedRoute); }
    setBusy(false);
  }
  async function assignCrew(e: FormEvent, assignmentType: 'driver' | 'assistant') {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const selectedId = assignmentType === 'driver' ? driverId : assistantId;
    const { error: err } = await client.from('transport_route_drivers').insert({ school_id: schoolId, route_id: selectedRoute, membership_id: selectedId, assignment_type: assignmentType });
    if (err) setError(err.code === '23505' ? 'This person is already assigned to the route.' : 'Crew assignment failed. Confirm the account is active bus staff.');
    else { if (assignmentType === 'driver') setDriverId(''); else setAssistantId(''); setNotice(assignmentType === 'driver' ? 'Driver assigned to this route.' : 'Bus assistant assigned to this route.'); await loadAdmin(); }
    setBusy(false);
  }
  async function assignStudent(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const { error: err } = await client.from('transport_route_students').insert({ school_id: schoolId, route_id: selectedRoute, student_id: studentId, pickup_stop_id: pickupStopId || null, dropoff_stop_id: dropoffStopId || null });
    if (err) setError(err.code === '23505' ? 'This student is already assigned to this route.' : 'Student could not be assigned. Check the selected stops.');
    else { setStudentId(''); setPickupStopId(''); setDropoffStopId(''); setNotice('Student assigned to this route.'); await loadAssignments(selectedRoute); }
    setBusy(false);
  }
  async function recordEvent(eventType: 'picked_up' | 'dropped_off' | 'missed' | 'incident', student: RouteStudent) {
    setBusy(true); setError(''); setNotice('');
    const { error: err } = await client.rpc('record_transport_event', { p_school_id: schoolId, p_route_id: selectedRoute, p_student_id: student.student_id, p_event_type: eventType, p_stop_id: eventType === 'picked_up' ? student.pickup_stop_id : eventType === 'dropped_off' ? student.dropoff_stop_id : null, p_note: note.trim() || null });
    if (err) setError(err.message.includes('already recorded') || err.message.includes('must be picked') ? err.message : 'The journey update could not be saved. Check your route assignment and connection.');
    else { setNote(''); setNotice('Journey update saved securely.'); await loadAssignments(selectedRoute); }
    setBusy(false);
  }

  async function resolveDriverQr(rawValue: string) {
    setCameraError(''); setError(''); setNotice('');
    let token = rawValue.trim();
    if (/^https?:\/\//i.test(token)) {
      try { const scannedUrl = new URL(token); if (scannedUrl.origin === 'https://tagin.smartschoolpro2026.workers.dev' && scannedUrl.pathname === '/scan') token = scannedUrl.searchParams.get('code') || ''; }
      catch { /* Validate raw QR below. */ }
    }
    if (token.toUpperCase().startsWith('TAGIN:')) token = token.slice(6).trim();
    if (!token) { setCameraError('This QR code is empty.'); return; }
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const { data: tag, error: tagError } = await client.from('tags').select('student_id').eq('school_id', schoolId).eq('token_hash', tokenHash).eq('status', 'active').maybeSingle();
      if (tagError || !tag) { setCameraError('This is not an active TagIn student QR for this school.'); return; }
      const assigned = assignments.find((item) => item.student_id === tag.student_id);
      if (!assigned || !assigned.students?.active) { setCameraError('This student is not assigned to your current route.'); return; }
      const { data: nextAction, error: nextError } = await client.rpc('get_next_transport_action', { p_school_id: schoolId, p_route_id: selectedRoute, p_student_id: tag.student_id });
      if (nextError || !nextAction) { setCameraError(nextError?.message || 'The next journey step could not be verified.'); return; }
      const stopId = nextAction === 'picked_up' ? assigned.pickup_stop_id : nextAction === 'dropped_off_at_home' ? assigned.dropoff_stop_id : null;
      const { error: saveError } = await client.rpc('record_transport_event', { p_school_id: schoolId, p_route_id: selectedRoute, p_student_id: tag.student_id, p_event_type: nextAction, p_stop_id: stopId, p_note: null });
      if (saveError) { setCameraError(saveError.message || 'The transport scan could not be saved.'); return; }
      const labels: Record<string, string> = { picked_up: 'Picked up at home', arrived_at_school: 'Dropped off at school', boarded_at_school: 'Boarded bus at school', dropped_off_at_home: 'Dropped off at home' };
      setNotice((assigned.students.full_name || 'Student') + ' · ' + (labels[nextAction] || 'Journey updated'));
      await loadAssignments(selectedRoute);
    } catch { setCameraError('The QR code could not be verified. Please try again.'); }
  }

  useEffect(() => {
    if (mode !== 'driver' || !scanActive) return;
    let alive = true; let frame = 0; let stream: MediaStream | null = null; let detector: QRDetector | null = null; let busyFrame = false;
    const Detector = (window as Window & { BarcodeDetector?: QRDetectorConstructor }).BarcodeDetector;
    async function startCamera() {
      if (!Detector) { setCameraError('QR scanning is not supported here. Please use an updated Chrome browser on Android.'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setCameraError('Camera access requires the secure TagIn website.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
        if (!alive) { stream.getTracks().forEach((track) => track.stop()); return; }
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream; await videoRef.current.play(); detector = new Detector({ formats: ['qr_code'] });
        const scanFrame = async () => {
          if (!alive || !detector || !videoRef.current || busyFrame) return;
          busyFrame = true;
          try { const codes = await detector.detect(videoRef.current); if (alive && codes.length && codes[0].rawValue) { alive = false; setScanActive(false); void resolveDriverQr(codes[0].rawValue); } }
          catch { /* Ignore transient camera frame errors. */ }
          finally { busyFrame = false; }
          if (alive) frame = requestAnimationFrame(scanFrame);
        };
        frame = requestAnimationFrame(scanFrame);
      } catch (cameraException) {
        setCameraError(cameraException instanceof Error && cameraException.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings.' : 'The camera could not be opened. Check that another app is not using it.');
      }
    }
    void startCamera();
    return () => { alive = false; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); if (videoRef.current) videoRef.current.srcObject = null; };
  }, [mode, scanActive]);

  const latestEvent = (id: string) => events.find((e) => e.student_id === id && ['picked_up','arrived_at_school','boarded_at_school','dropped_off_at_home','dropped_off'].includes(e.event_type));
  const isAdmin = mode === 'admin';
  return <section className="transport-workspace">
    <div className="transport-heading">
      <div><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">{isAdmin ? 'SCHOOL OPERATIONS' : 'DRIVER WORKSPACE'}</p><h1>{isAdmin ? 'Transport management' : 'My journeys'}</h1><p className="muted">{schoolName} · {isAdmin ? 'Manage vehicles, routes, drivers and student allocations.' : 'Record student pickup and drop-off on your assigned routes.'}</p></div>
      <div className="transport-heading-icon"><BusFront size={28}/></div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="student-notice" role="status">{notice}</p>}
    {loading ? <div className="student-empty">Loading transport workspace…</div> : isAdmin ? <>
      <div className="transport-stats"><article><BusFront/><strong>{vehicles.filter(v=>v.active).length}</strong><span>Active vehicles</span></article><article><Route/><strong>{routes.filter(r=>r.active).length}</strong><span>Active routes</span></article><article><Users/><strong>{drivers.length}</strong><span>Available drivers</span></article></div>
      <div className="transport-admin-grid">
        <form className="transport-panel" onSubmit={saveVehicle}><h2><BusFront size={18}/> Add vehicle</h2><label>Registration number</label><input value={registration} onChange={e=>setRegistration(e.target.value)} placeholder="e.g. ABC-123XY" required maxLength={24}/><label>Vehicle name (optional)</label><input value={vehicleName} onChange={e=>setVehicleName(e.target.value)} placeholder="e.g. School Bus 01" maxLength={80}/><label>Passenger capacity</label><input type="number" min="1" max="100" value={capacity} onChange={e=>setCapacity(e.target.value)} required/><button className="primary-button" disabled={busy}>Save vehicle <Plus size={15}/></button></form>
        <form className="transport-panel" onSubmit={saveRoute}><h2><Route size={18}/> Create route</h2><label>Route name</label><input value={routeName} onChange={e=>setRouteName(e.target.value)} placeholder="e.g. Lekki Phase 1" required maxLength={100}/><label>Journey direction</label><select value={direction} onChange={e=>setDirection(e.target.value)}><option value="both">Morning and afternoon</option><option value="morning">Morning pickup</option><option value="afternoon">Afternoon drop-off</option></select><label>Vehicle</label><select value={vehicleId} onChange={e=>setVehicleId(e.target.value)}><option value="">Select vehicle (optional)</option>{vehicles.filter(v=>v.active).map(v=><option key={v.id} value={v.id}>{v.registration_number} · {v.vehicle_name || 'Vehicle'}</option>)}</select><button className="primary-button" disabled={busy}>Create route <Plus size={15}/></button></form>
      </div>
      <div className="transport-panel transport-route-panel"><div className="transport-panel-title"><div><h2>Route setup</h2><p>Select a route to manage its stops, driver and students.</p></div><select aria-label="Select route" value={selectedRoute} onChange={e=>setSelectedRoute(e.target.value)}><option value="">Select route</option>{routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        {!activeRoute ? <div className="student-empty">Create your first route to begin assigning stops, drivers and students.</div> : <>
          <div className="transport-route-summary"><strong>{activeRoute.name}</strong><span>{activeRoute.direction} · {activeRoute.transport_vehicles?.registration_number || vehicles.find(v=>v.id===activeRoute.vehicle_id)?.registration_number || 'No vehicle selected'}</span></div>
          <div className="transport-setup-grid">
            <form onSubmit={saveStop}><h3><MapPin size={16}/> Add route stop</h3><label>Stop name</label><input value={stopName} onChange={e=>setStopName(e.target.value)} placeholder="e.g. Admiralty Way" required maxLength={120}/><label>Scheduled time (optional)</label><input type="time" value={stopTime} onChange={e=>setStopTime(e.target.value)}/><button className="secondary-button" disabled={busy}>Add stop</button></form>
            <form onSubmit={e=>void assignCrew(e,'driver')}><h3><ShieldCheck size={16}/> Assign driver</h3><label>Active bus staff</label><select value={driverId} onChange={e=>setDriverId(e.target.value)} required><option value="">Select driver</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.profiles?.full_name || d.user_id}</option>)}</select><button className="secondary-button" disabled={busy}>Assign driver</button></form><form onSubmit={e=>void assignCrew(e,'assistant')}><h3><Users size={16}/> Assign bus assistant</h3><label>Active bus staff</label><select value={assistantId} onChange={e=>setAssistantId(e.target.value)} required><option value="">Select assistant</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.profiles?.full_name || d.user_id}</option>)}</select><button className="secondary-button" disabled={busy}>Assign assistant</button></form>
            <form onSubmit={assignStudent}><h3><Users size={16}/> Add student to route</h3><label>Active student</label><select value={studentId} onChange={e=>setStudentId(e.target.value)} required><option value="">Select student</option>{students.map(s=><option key={s.id} value={s.id}>{s.full_name}{s.class_name ? ' · '+s.class_name : ''}</option>)}</select><label>Pickup stop</label><select value={pickupStopId} onChange={e=>setPickupStopId(e.target.value)}><option value="">Not set</option>{routeStops.map(s=><option key={s.id} value={s.id}>{s.stop_order}. {s.stop_name}</option>)}</select><label>Drop-off stop</label><select value={dropoffStopId} onChange={e=>setDropoffStopId(e.target.value)}><option value="">Not set</option>{routeStops.map(s=><option key={s.id} value={s.id}>{s.stop_order}. {s.stop_name}</option>)}</select><button className="secondary-button" disabled={busy}>Assign student</button></form>
          </div>
          <div className="transport-lists-grid"><div><h3>Stops ({routeStops.length})</h3>{routeStops.map(s=><div className="transport-list-row" key={s.id}><span>{s.stop_order}. {s.stop_name}</span><small>{s.scheduled_time?.slice(0,5) || 'Time not set'}</small></div>)}</div><div><h3>Assigned students ({assignments.length})</h3>{assignments.map(a=><div className="transport-list-row" key={a.id}><span>{a.students?.full_name || 'Student'}</span><small>{a.students?.class_name || 'Class not set'}</small></div>)}</div></div>
        </>}
      </div>
      <div className="transport-panel"><h2>Vehicles and routes</h2><div className="transport-lists-grid"><div><h3>Vehicles</h3>{vehicles.map(v=><div className="transport-list-row" key={v.id}><span>{v.registration_number} · {v.vehicle_name || 'School vehicle'}</span><small>{v.capacity} seats · {v.active?'Active':'Inactive'}</small></div>)}{!vehicles.length&&<p className="muted">No vehicles registered yet.</p>}</div><div><h3>Routes</h3>{routes.map(r=><div className="transport-list-row" key={r.id}><span>{r.name}</span><small>{r.direction} · {r.active?'Active':'Inactive'}</small></div>)}{!routes.length&&<p className="muted">No routes created yet.</p>}</div></div></div>
    </> : <>
      {routes.length===0 ? <div className="transport-panel transport-empty"><BusFront size={28}/><h2>No journeys assigned</h2><p>Your school administrator has not assigned you as a driver or bus assistant yet.</p></div> : <>
        <div className="transport-panel">
          <div className="transport-panel-title"><div><h2>Today's assigned route</h2><p>Only students assigned to this bus appear here.</p></div><select aria-label="Select assigned route" value={selectedRoute} onChange={e=>setSelectedRoute(e.target.value)}>{routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div className="transport-route-summary"><strong>{activeRoute?.name}</strong><span>{activeRoute?.transport_vehicles?.registration_number || 'Vehicle details'} · {activeRoute?.direction}</span></div>
          <div className="transport-stops-strip">{routeStops.map(s=><span key={s.id}><MapPin size={13}/>{s.stop_order}. {s.stop_name}</span>)}</div>
          <div className="transport-driver-safety"><ShieldCheck size={17}/><span>Use the scanner only when the bus is safely stopped. If you have an assistant, let them scan while you drive.</span></div>
          {scanActive ? <div className="transport-camera-panel"><div className="transport-camera-heading"><strong>Scan student QR</strong><button type="button" className="icon-button" onClick={()=>setScanActive(false)} aria-label="Close scanner"><X size={18}/></button></div><div className="transport-camera-stage"><video ref={videoRef} autoPlay muted playsInline/><div className="transport-camera-frame"/></div><p className="muted">Hold the student's TagIn QR inside the frame.</p>{cameraError && <p className="form-error" role="alert">{cameraError}</p>}</div> : <div className="transport-scan-action"><button type="button" className="transport-scan-button" disabled={!activeRoute || busy} onClick={()=>{setCameraError('');setScanActive(true);}}><Camera size={25}/><span>Scan student</span><small>TagIn chooses the correct journey step automatically</small></button>{cameraError && <p className="form-error" role="alert">{cameraError}</p>}</div>}
          <div className="transport-driver-list"><div className="transport-list-heading"><h3>Students on this route</h3><span>{assignments.length} assigned</span></div>
            {assignments.map(a=>{const last=latestEvent(a.student_id);const labels:Record<string,string>={picked_up:'Picked up at home',arrived_at_school:'Dropped off at school',boarded_at_school:'Boarded at school',dropped_off_at_home:'Dropped off at home',dropped_off:'Dropped off'};return <article className="transport-student-row" key={a.id}><div className="transport-student-avatar">{(a.students?.full_name||'S').split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div className="transport-student-info"><strong>{a.students?.full_name||'Student'}</strong><span>{a.students?.class_name||'Class not set'}</span><small>{last?labels[last.event_type]+' · '+stamp(last.created_at):'Waiting for pickup'}</small></div></article>;})}
            {assignments.length===0&&<div className="student-empty">No students are assigned to this route yet.</div>}
          </div>
        </div>
        <div className="transport-panel"><h2><Clock3 size={18}/> Recent journey activity</h2>{events.slice(0,20).map(e=><div className="transport-list-row" key={e.id}><span>{assignments.find(a=>a.student_id===e.student_id)?.students?.full_name || 'Student'} · {e.event_type.replaceAll('_',' ')}</span><small>{stamp(e.created_at)}</small></div>)}{!events.length&&<p className="muted">No journey events have been recorded yet.</p>}</div>
      </>}
    </>}
    <p className="transport-footnote"><CheckCircle2 size={14}/> Transport activity is separate from school attendance. A bus pickup never checks a student into school.</p>
  </section>;
}
