import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight, Bell, BusFront, CheckCircle2, ClipboardList, Clock3, GraduationCap,
  LogOut, QrCode, ShieldCheck, Users, ScanLine, Play, ArrowLeft, UserRound,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Profile = {
  full_name: string;
  platform_role: 'user' | 'super_admin';
  is_active: boolean;
  must_change_password: boolean;
};
type Membership = {
  school_id: string;
  role: 'school_admin' | 'gate_staff' | 'bus_staff' | 'parent';
  status: 'active' | 'inactive';
  schools: { name: string; slug: string } | null;
};
type DemoRole = 'school_admin' | 'gate_staff' | 'bus_staff' | 'parent';
type DemoStudent = {
  id: number;
  name: string;
  className: string;
  guardian: string;
  collector: string;
  status: 'At home' | 'At school';
  bus: boolean;
  busStatus: 'Not on bus' | 'Picked up' | 'Dropped off';
};
type DemoEvent = { id: number; student: string; message: string; time: string; kind: 'arrival' | 'departure' | 'bus' };

const initialStudents: DemoStudent[] = [
  { id: 1, name: 'Amara Okafor', className: 'Primary 3', guardian: 'Mrs. Okafor', collector: 'Mrs. Okafor', status: 'At home', bus: true, busStatus: 'Not on bus' },
  { id: 2, name: 'Daniel Bello', className: 'Primary 2', guardian: 'Mr. Bello', collector: 'Mr. Bello', status: 'At school', bus: false, busStatus: 'Not on bus' },
  { id: 3, name: 'Zara Adeyemi', className: 'Nursery 2', guardian: 'Mrs. Adeyemi', collector: 'Auntie Tola', status: 'At school', bus: true, busStatus: 'Picked up' },
];
const initialEvents: DemoEvent[] = [
  { id: 1, student: 'Zara Adeyemi', message: 'Arrived at school · Gate 1', time: '8:12 AM', kind: 'arrival' },
  { id: 2, student: 'Daniel Bello', message: 'Arrived at school · Gate 1', time: '8:04 AM', kind: 'arrival' },
  { id: 3, student: 'Zara Adeyemi', message: 'Bus pickup completed', time: '7:26 AM', kind: 'bus' },
];

export default function App() {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let alive = true;
    client.auth.getSession().then(({ data }) => {
      if (alive) { setSession(data.session); setLoading(false); }
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setMemberships([]); setSchoolId(''); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!client || !session) {
      setProfile(null); setMemberships([]); setLoading(false); return;
    }
    const supabaseClient = client;
    let alive = true;
    const loadAccount = async () => {
      setLoading(true); setError('');
      const [profileResult, membershipsResult] = await Promise.all([
        supabaseClient.from('profiles').select('full_name, platform_role, is_active, must_change_password').eq('id', session.user.id).maybeSingle(),
        supabaseClient.from('school_memberships').select('school_id, role, status, schools(name, slug)').eq('user_id', session.user.id).eq('status', 'active'),
      ]);
      if (!alive) return;
      if (profileResult.error || membershipsResult.error) {
        setError('We could not load your account permissions. Please try again or contact your school administrator.');
      } else if (!profileResult.data || !profileResult.data.is_active) {
        setError('This account is not active or has not been fully set up. Please contact your school administrator.');
      } else {
        setProfile(profileResult.data as Profile);
        const activeMemberships = (membershipsResult.data ?? []) as unknown as Membership[];
        setMemberships(activeMemberships);
        setSchoolId((current) => current || activeMemberships[0]?.school_id || '');
      }
      setLoading(false);
    };
    void loadAccount();
    return () => { alive = false; };
  }, [session]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.school_id === schoolId) ?? memberships[0],
    [memberships, schoolId],
  );

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true); setError('');
    const { data: loginData, error: authError } = await client.functions.invoke('phone-password-login', { body: { phone: phone.trim(), password } });
    if (authError || !loginData?.session?.access_token || !loginData?.session?.refresh_token) {
      setError('Phone number or password is incorrect. Check your details or contact your school administrator.');
    } else {
      const { error: sessionError } = await client.auth.setSession({ access_token: loginData.session.access_token, refresh_token: loginData.session.refresh_token });
      if (sessionError) setError('We could not start your secure session. Please try again.');
    }
    setBusy(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    if (newPassword.length < 12) { setError('Choose a password with at least 12 characters.'); return; }
    setBusy(true); setError('');
    const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
    if (passwordError) setError(passwordError.message);
    else {
      const { error: functionError } = await client.functions.invoke('change-password', { body: {} });
      if (functionError) setError('Your password changed, but account setup could not be finalized. Please sign in again or contact your administrator.');
      else { setProfile((current) => current ? { ...current, must_change_password: false } : current); setNewPassword(''); }
    }
    setBusy(false);
  }

  async function signOut() {
    if (!client) return;
    setBusy(true); await client.auth.signOut(); setBusy(false);
  }

  if (demoMode) return <DemoWorkspace onExit={() => setDemoMode(false)} />;

  if (!isSupabaseConfigured || !client) {
    return <main className="auth-shell"><Brand /><section className="auth-card setup-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">INITIAL SETUP</p><h1>Connect TagIn to your school workspace.</h1><p className="muted">The application is ready. Add the Supabase project URL and public publishable key to your local environment to enable secure sign-in.</p><div className="code-note">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, then fill in the two Vite environment variables.</div></section></main>;
  }
  if (loading) return <main className="auth-shell"><Brand /><div className="loading-card">Loading your secure school workspace…</div></main>;

  if (!session) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><div className="auth-icon"><QrCode size={25} /></div><p className="eyebrow">WELCOME TO TAGIN</p><h1>Sign in to your school account.</h1><p className="muted">Use the phone number and password provided by your school.</p><form className="auth-form" onSubmit={signIn}><label htmlFor="phone">Phone number</label><input id="phone" type="tel" autoComplete="tel" placeholder="+2348012345678" value={phone} onChange={(event) => setPhone(event.target.value)} required /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button></form><div className="demo-divider"><span>OR</span></div><button className="demo-button" type="button" onClick={() => setDemoMode(true)}><Play size={16} /> Explore interactive demo</button><p className="auth-footnote">Demo uses fictional sample records only. No real school registration or account is needed.</p></section><p className="security-note"><ShieldCheck size={14} /> Your school data is protected by role-based access controls.</p></main>;
  }
  if (profile?.must_change_password) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">SECURITY CHECK</p><h1>Create your new password.</h1><p className="muted">For your protection, change the temporary password before continuing.</p><form className="auth-form" onSubmit={changePassword}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={17} /></button></form></section></main>;
  }
  if (!profile) return <main className="auth-shell"><Brand /><section className="auth-card"><h1>Account setup incomplete.</h1><p className="muted">{error || 'Please contact your school administrator.'}</p><button className="secondary-button" onClick={signOut}>Sign out</button></section></main>;

  const isPlatformAdmin = profile.platform_role === 'super_admin';
  const role = isPlatformAdmin ? 'Platform administrator' : selectedMembership?.role?.replace('_', ' ') ?? 'School member';
  const schoolName = selectedMembership?.schools?.name ?? (isPlatformAdmin ? 'All schools' : 'No active school');
  return <main className="workspace-shell"><header className="workspace-topbar"><Brand /><div className="account-actions"><span className="user-chip">{profile.full_name}</span><button className="icon-button" onClick={signOut} disabled={busy} aria-label="Sign out"><LogOut size={18} /></button></div></header><section className="welcome-panel"><div><p className="eyebrow">YOUR TAGIN WORKSPACE</p><h1>Hello, {profile.full_name.split(' ')[0]}.</h1><p className="muted">Your school day, connected.</p></div><div className="welcome-mark"><GraduationCap size={42} /></div></section><section className="workspace-meta"><div><span className="meta-label">ACCESS LEVEL</span><strong>{role}</strong></div><div><span className="meta-label">SCHOOL</span>{memberships.length > 1 ? <select aria-label="Select school" value={selectedMembership?.school_id ?? ''} onChange={(event) => setSchoolId(event.target.value)}>{memberships.map((item) => <option key={item.school_id} value={item.school_id}>{item.schools?.name ?? item.school_id}</option>)}</select> : <strong>{schoolName}</strong>}</div></section>{error && <p className="form-error" role="alert">{error}</p>}<section className="workspace-section"><p className="eyebrow">YOUR WORKSPACE</p><h2>{isPlatformAdmin ? 'Platform overview' : 'School operations'}</h2><div className="workspace-grid">{isPlatformAdmin && <WorkspaceCard icon={<ShieldCheck />} title="School management" description="Create and manage school workspaces and administrators." />}{(isPlatformAdmin || selectedMembership?.role === 'school_admin') && <WorkspaceCard icon={<Users />} title="People and students" description="Manage student records, families, and staff access." />}{(isPlatformAdmin || ['school_admin', 'gate_staff'].includes(selectedMembership?.role ?? '')) && <WorkspaceCard icon={<QrCode />} title="Gate check-in" description="Prepare secure student tag scanning and attendance workflows." />}{(isPlatformAdmin || ['school_admin', 'bus_staff'].includes(selectedMembership?.role ?? '')) && <WorkspaceCard icon={<BusFront />} title="Transport" description="Manage bus pickup, boarding, and drop-off workflows." />}{(isPlatformAdmin || selectedMembership?.role === 'parent') && <WorkspaceCard icon={<Bell />} title="Family updates" description="View your children's arrival, departure, and transport notifications." />}{!isPlatformAdmin && !selectedMembership && <WorkspaceCard icon={<ShieldCheck />} title="No school assigned" description="Your account is active, but no active school membership was found. Contact your administrator." />}</div></section><footer className="workspace-footer"><span>TagIn · Safer school journeys</span><span><CheckCircle2 size={14} /> Secure session</span></footer></main>;
}

function DemoWorkspace({ onExit }: { onExit: () => void }) {
  const [role, setRole] = useState<DemoRole>('school_admin');
  const [students, setStudents] = useState(initialStudents);
  const [events, setEvents] = useState(initialEvents);
  const [selectedStudent, setSelectedStudent] = useState(1);
  const [collector, setCollector] = useState('Mrs. Okafor');
  const [notice, setNotice] = useState('Demo mode is active. All changes stay in this browser session.');
  const student = students.find((item) => item.id === selectedStudent) ?? students[0];
  const addEvent = (studentName: string, message: string, kind: DemoEvent['kind']) => {
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setEvents((current) => [{ id: Date.now(), student: studentName, message, time: now, kind }, ...current]);
    setNotice(message + ' — demo event recorded locally.');
  };
  const updateStudent = (id: number, patch: Partial<DemoStudent>) => setStudents((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const doCheckIn = () => {
    if (student.status === 'At school') { setNotice(student.name + ' is already marked as at school.'); return; }
    updateStudent(student.id, { status: 'At school' });
    addEvent(student.name, 'Signed in at Gate 1', 'arrival');
  };
  const doCheckOut = () => {
    if (student.status === 'At home') { setNotice(student.name + ' is already marked as at home.'); return; }
    updateStudent(student.id, { status: 'At home' });
    addEvent(student.name, 'Signed out · Collected by ' + collector, 'departure');
  };
  const doBus = (action: 'Picked up' | 'Dropped off') => {
    updateStudent(student.id, { busStatus: action });
    addEvent(student.name, action === 'Picked up' ? 'Bus pickup completed' : 'Bus drop-off completed', 'bus');
  };
  const roleOptions: { value: DemoRole; label: string }[] = [
    { value: 'school_admin', label: 'Admin' }, { value: 'gate_staff', label: 'Gate staff' },
    { value: 'bus_staff', label: 'Bus staff' }, { value: 'parent', label: 'Parent' },
  ];
  return <main className="demo-shell">
    <header className="demo-topbar"><Brand /><div className="demo-top-actions"><span className="demo-pill"><span /> DEMO MODE</span><button className="demo-exit" onClick={onExit}><ArrowLeft size={15} /> Exit demo</button></div></header>
    <section className="demo-hero"><div><p className="eyebrow">TAGIN · SAMPLE SCHOOL</p><h1>Good afternoon, Alex.</h1><p className="muted">Welcome to Greenfield Academy's demo workspace.</p></div><div className="demo-hero-icon"><GraduationCap size={34} /></div></section>
    <div className="demo-warning"><ShieldCheck size={17} /><span><strong>Safe demo environment.</strong> Fictional students only. Actions are temporary and are not saved to Supabase.</span></div>
    <nav className="demo-role-switch" aria-label="Switch demo role">{roleOptions.map((item) => <button key={item.value} className={role === item.value ? 'active' : ''} onClick={() => setRole(item.value)}>{item.label}</button>)}</nav>
    {role === 'school_admin' && <>
      <section className="demo-stats"><DemoStat label="Students" value={String(students.length)} icon={<Users />} /><DemoStat label="At school" value={String(students.filter((s) => s.status === 'At school').length)} icon={<CheckCircle2 />} /><DemoStat label="On school bus" value={String(students.filter((s) => s.busStatus === 'Picked up').length)} icon={<BusFront />} /></section>
      <section className="demo-panel"><div className="demo-panel-heading"><div><p className="eyebrow">SCHOOL DIRECTORY</p><h2>Students</h2></div><span className="sample-label">SAMPLE DATA</span></div>{students.map((s) => <div className="demo-student-row" key={s.id}><div className="student-avatar">{s.name.split(' ').map((n) => n[0]).join('')}</div><div className="student-details"><strong>{s.name}</strong><span>{s.className} · {s.guardian}</span></div><span className={s.status === 'At school' ? 'status-chip present' : 'status-chip home'}>{s.status}</span></div>)}</section>
    </>}
    {role === 'gate_staff' && <section className="demo-panel"><div className="demo-panel-heading"><div><p className="eyebrow">GATE SCANNER</p><h2>Student arrival & collection</h2></div><div className="scanner-icon"><ScanLine size={22} /></div></div><label className="demo-label" htmlFor="gate-student">Choose a sample student</label><select id="gate-student" className="demo-select" value={selectedStudent} onChange={(e) => { const id=Number(e.target.value); setSelectedStudent(id); const found=students.find((s)=>s.id===id); if(found) setCollector(found.collector); }}>{students.map((s)=><option key={s.id} value={s.id}>{s.name} · {s.className}</option>)}</select><div className="scan-preview"><div className="scan-qr"><QrCode size={48} /></div><div><strong>{student.name}</strong><span>{student.className}</span><span className={student.status === 'At school' ? 'status-chip present' : 'status-chip home'}>{student.status}</span></div></div><label className="demo-label" htmlFor="collector">Authorized collector</label><select id="collector" className="demo-select" value={collector} onChange={(e)=>setCollector(e.target.value)}><option>{student.collector}</option><option>{student.guardian}</option><option>Mr. James · Approved one-day collector</option></select><div className="demo-action-row"><button className="demo-action primary" onClick={doCheckIn} disabled={student.status==='At school'}><CheckCircle2 size={16}/> Sign in</button><button className="demo-action" onClick={doCheckOut} disabled={student.status==='At home'}><LogOut size={16}/> Sign out</button></div><p className="demo-hint">Camera scanning is simulated in this demo. Real QR scanning will require an authenticated staff account.</p></section>}
    {role === 'bus_staff' && <section className="demo-panel"><div className="demo-panel-heading"><div><p className="eyebrow">TRANSPORT MODE</p><h2>Bus movement</h2></div><BusFront size={24} /></div><label className="demo-label" htmlFor="bus-student">Choose a sample student</label><select id="bus-student" className="demo-select" value={selectedStudent} onChange={(e)=>setSelectedStudent(Number(e.target.value))}>{students.filter((s)=>s.bus).map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select><div className="scan-preview"><div className="student-avatar large">{student.name.split(' ').map((n)=>n[0]).join('')}</div><div><strong>{student.name}</strong><span>{student.className} · School bus</span><span className="status-chip bus-status">{student.busStatus}</span></div></div><div className="demo-action-row"><button className="demo-action primary" onClick={()=>doBus('Picked up')} disabled={student.busStatus==='Picked up'}><BusFront size={16}/> Picked up</button><button className="demo-action" onClick={()=>doBus('Dropped off')} disabled={student.busStatus==='Dropped off'}><CheckCircle2 size={16}/> Dropped off</button></div><p className="demo-hint">Sample bus events update the demo activity feed only.</p></section>}
    {role === 'parent' && <section className="demo-panel"><div className="demo-panel-heading"><div><p className="eyebrow">PARENT APP</p><h2>Family activity</h2></div><Bell size={23}/></div><div className="parent-child-card"><div className="student-avatar large">AO</div><div><strong>Amara Okafor</strong><span>Primary 3 · Greenfield Academy</span><span className={students[0].status === 'At school' ? 'status-chip present' : 'status-chip home'}>{students[0].status}</span></div></div><h3 className="activity-title">Recent updates</h3><EventList events={events.filter((e)=>e.student==='Amara Okafor' || e.kind==='bus').slice(0,5)}/><p className="demo-hint">Push alerts are represented here as sample in-app activity. No message is sent.</p></section>}
    <section className="demo-activity"><div className="demo-panel-heading"><div><p className="eyebrow">LIVE DEMO FEED</p><h2>Recent activity</h2></div><span className="activity-count">{events.length} events</span></div><EventList events={events.slice(0,5)}/></section>
    <div className="demo-toast" role="status"><CheckCircle2 size={16}/>{notice}</div>
    <footer className="workspace-footer"><span>TagIn · Safer school journeys</span><span><ShieldCheck size={14}/> Demo data only</span></footer>
  </main>;
}

function DemoStat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <article className="demo-stat"><div className="demo-stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}
function EventList({ events }: { events: DemoEvent[] }) {
  if (!events.length) return <p className="demo-hint">No activity yet. Try a demo action to create one.</p>;
  return <div className="event-list">{events.map((event)=><div className="event-row" key={event.id}><div className={'event-icon '+event.kind}>{event.kind==='bus'?<BusFront size={16}/>:event.kind==='arrival'?<CheckCircle2 size={16}/>:<LogOut size={16}/>}</div><div><strong>{event.student}</strong><span>{event.message}</span></div><time>{event.time}</time></div>)}</div>;
}
function Brand() { return <a className="brand" href="#top"><span className="brand-mark"><QrCode size={20}/></span><span>TagIn</span></a>; }
function WorkspaceCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <article className="workspace-card"><div className="workspace-card-icon">{icon}</div><h3>{title}</h3><p>{description}</p><span className="coming-soon">FOUNDATION READY</span></article>;
}
