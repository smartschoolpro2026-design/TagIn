import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight, Award, Bell, BusFront, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, HeartHandshake, ShieldCheck,
  Eye, EyeOff, LogOut, QrCode, Users,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { StudentDirectory } from './components/StudentDirectory';
import { AdvancedStudentWorkspace } from './components/AdvancedStudentWorkspace';
import { AttendanceWorkspace } from './components/AttendanceWorkspace';
import { StaffWorkspace } from './components/StaffWorkspace';
import { FamilyWorkspace } from './components/FamilyWorkspace';
import { TransportWorkspace } from './components/TransportWorkspace';
import { TimetableWorkspace } from './components/TimetableWorkspace';
import { ScoresWorkspace } from './components/ScoresWorkspace';
import { PublicLandingPage } from './components/PublicLandingPage';

type Profile = {
  full_name: string;
  platform_role: 'user' | 'super_admin';
  is_active: boolean;
  must_change_password: boolean;
};
type School = { id: string; name: string; slug: string; address: string | null; status: 'active' | 'suspended'; created_at: string };
type Membership = {
  id: string;
  school_id: string;
  role: 'school_admin' | 'staff' | 'gate_staff' | 'bus_staff' | 'parent';
  status: 'active' | 'inactive';
  schools: { name: string; slug: string } | null;
};
export default function App() {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [guardianSchoolIds, setGuardianSchoolIds] = useState<string[]>([]);
  const [staffJobTitle, setStaffJobTitle] = useState('Staff member');
  const [staffPermissions, setStaffPermissions] = useState<string[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSignIn, setShowSignIn] = useState(false);
  const [error, setError] = useState('');
  const [showSchoolManagement, setShowSchoolManagement] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<'students' | 'attendance' | 'staff' | 'families' | 'family' | 'transport-admin' | 'transport-driver' | 'timetable-admin' | 'timetable-teacher' | 'timetable-parent' | 'scores-admin' | 'scores-teacher' | 'scores-parent' | 'students-advanced' | ''>('');
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolNameInput, setSchoolNameInput] = useState('');
  const [schoolSlugInput, setSchoolSlugInput] = useState('');
  const [schoolAddressInput, setSchoolAddressInput] = useState('');
  const [adminSchoolId, setAdminSchoolId] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [createdAdmin, setCreatedAdmin] = useState<{ fullName: string; phone: string; temporaryPassword: string } | null>(null);

  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let alive = true;
    // INITIAL_SESSION is emitted by Supabase Auth after it has loaded local
    // storage. Use this single initialization path instead of racing
    // getSession() against the auth-state subscription.
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      setSession(nextSession);
      setLoading(false);
      if (!nextSession) { setProfile(null); setMemberships([]); setGuardianSchoolIds([]); setSchoolId(''); setShowSignIn(false); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!client || !session) {
      setProfile(null); setMemberships([]); setGuardianSchoolIds([]); setLoading(false); return;
    }
    const supabaseClient = client;
    let alive = true;
    const loadAccount = async () => {
      setLoading(true); setError('');
      const [profileResult, membershipsResult, guardianResult] = await Promise.all([
        supabaseClient.from('profiles').select('full_name, platform_role, is_active, must_change_password').eq('id', session.user.id).maybeSingle(),
        supabaseClient.from('school_memberships').select('id, school_id, role, status, schools(name, slug)').eq('user_id', session.user.id).eq('status', 'active'),
        supabaseClient.from('guardians').select('school_id').eq('user_id', session.user.id),
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
        setGuardianSchoolIds((guardianResult.data ?? []).map((item) => item.school_id));
        setSchoolId((current) => current || activeMemberships[0]?.school_id || '');
      }
      setLoading(false);
    };
    void loadAccount();
    return () => { alive = false; };
  }, [session]);

  const navigationReady = useRef(false);
  const restoringNavigation = useRef(false);
  const currentView = !session ? (showSignIn ? 'signin' : 'home') : showSchoolManagement ? 'school-management' : activeWorkspace || 'dashboard';

  useEffect(() => {
    // Keep a same-page history entry so Android's hardware Back button is
    // handled by TagIn instead of immediately leaving the app on first entry.
    if (!navigationReady.current) {
      const rootState = { taginNavigation: true, view: currentView, guard: true };
      window.history.replaceState(rootState, '', window.location.href);
      window.history.pushState(rootState, '', window.location.href);
      navigationReady.current = true;
      return;
    }
    if (restoringNavigation.current) {
      restoringNavigation.current = false;
      return;
    }
    window.history.pushState({ taginNavigation: true, view: currentView }, '', window.location.href);
  }, [currentView]);

  useEffect(() => {
    const handleBack = (event: PopStateEvent) => {
      const state = event.state as { taginNavigation?: boolean; view?: string; guard?: boolean } | null;
      if (!state?.taginNavigation || state.guard) {
        // A root sentinel can also be the previous in-app screen. Restore it
        // first; only re-arm it when already at that screen.
        const rootView = state?.taginNavigation ? (state.view ?? 'home') : 'home';
        if (rootView !== currentView) {
          restoringNavigation.current = true;
          setShowSchoolManagement(rootView === 'school-management');
          setActiveWorkspace(rootView === 'dashboard' || rootView === 'home' || rootView === 'signin' || rootView === 'school-management' ? '' : rootView as typeof activeWorkspace);
          if (rootView === 'signin') setShowSignIn(true);
          else if (rootView === 'home') setShowSignIn(false);
        } else {
          const rootState = { taginNavigation: true, view: currentView, guard: true };
          window.history.pushState(rootState, '', window.location.href);
        }
        return;
      }
      restoringNavigation.current = true;
      const view = state.view ?? 'home';
      setShowSchoolManagement(view === 'school-management');
      setActiveWorkspace(view === 'dashboard' || view === 'home' || view === 'signin' || view === 'school-management' ? '' : view as typeof activeWorkspace);
      if (view === 'signin') setShowSignIn(true);
      else if (view === 'home') setShowSignIn(false);
    };
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [currentView]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.school_id === schoolId) ?? memberships[0],
    [memberships, schoolId],
  );

  useEffect(() => {
    if (!client || profile?.platform_role !== 'super_admin' || !showSchoolManagement) return;
    let alive = true;
    const loadSchools = async () => {
      const { data, error: loadError } = await client.from('schools').select('id,name,slug,address,status,created_at').order('created_at', { ascending: false });
      if (!alive) return;
      if (loadError) setError('Could not load schools. Please try again.');
      else setSchools((data ?? []) as School[]);
    };
    void loadSchools();
    return () => { alive = false; };
  }, [client, profile?.platform_role, showSchoolManagement]);

  useEffect(() => {
    if (!client || !selectedMembership || selectedMembership.role !== 'staff') {
      setStaffJobTitle('Staff member');
      setStaffPermissions([]);
      return;
    }
    let alive = true;
    const loadStaffAccess = async () => {
      const [profileResult, permissionsResult] = await Promise.all([
        client.from('staff_profiles').select('job_title').eq('membership_id', selectedMembership.id).maybeSingle(),
        client.from('staff_permissions').select('permission_key').eq('membership_id', selectedMembership.id),
      ]);
      if (!alive) return;
      if (profileResult.error || permissionsResult.error) {
        setError('We could not load your assigned staff access. Please contact your school administrator.');
        setStaffJobTitle('Staff member');
        setStaffPermissions([]);
        return;
      }
      setStaffJobTitle(profileResult.data?.job_title ?? 'Staff member');
      setStaffPermissions((permissionsResult.data ?? []).map((item) => item.permission_key));
    };
    void loadStaffAccess();
    return () => { alive = false; };
  }, [client, selectedMembership?.id, selectedMembership?.role]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setError('');
    const timeout = <T,>(promise: Promise<T>, ms: number, message: string) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(message)), ms)),
      ]);
    try {
      const loginResponse = await timeout(
        fetch('/api/auth/phone-password-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim(), password }),
        }),
        15000,
        'The login service is taking too long to respond. Please check your connection and try again.',
      );
      const loginData = await loginResponse.json().catch(() => null) as { session?: Session; error?: string } | null;
      if (!loginResponse.ok) {
        const serverMessage = typeof loginData?.error === 'string' ? loginData.error : '';
        setError(serverMessage || (loginResponse.status === 401
          ? 'The phone number or password was not accepted. Please check the number format and password.'
          : loginResponse.status === 403
            ? 'This account cannot sign in right now. Contact your school administrator.'
            : 'TagIn could not reach the authentication service. Please try again shortly.'));
        return;
      }
      if (!loginData?.session?.access_token || !loginData?.session?.refresh_token) {
        setError('The authentication service responded, but did not return a complete secure session. This is a TagIn service issue, not a password error.');
        return;
      }
      const { error: sessionError } = await timeout(
        client.auth.setSession({
          access_token: loginData.session.access_token,
          refresh_token: loginData.session.refresh_token,
        }),
        10000,
        'Your details were accepted, but TagIn could not finish opening your secure session. Please try again.',
      );
      if (sessionError) {
        setError('Your details were accepted, but we could not start your secure session. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not complete sign-in. Please try again.');
    } finally {
      setBusy(false);
    }
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

  async function createSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || profile?.platform_role !== 'super_admin') return;
    const name = schoolNameInput.trim();
    const slug = schoolSlugInput.trim().toLowerCase();
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError('Enter a school name and a valid URL slug using lowercase letters, numbers, and hyphens.');
      return;
    }
    setBusy(true); setError('');
    const { data, error: insertError } = await client.from('schools').insert({ name, slug, address: schoolAddressInput.trim() || null }).select('id,name,slug,address,status,created_at').single();
    if (insertError) setError(insertError.code === '23505' ? 'That school URL slug is already in use. Choose another.' : 'Could not create the school. Please check the details and try again.');
    else if (data) {
      setSchools((current) => [data as School, ...current]);
      setSchoolNameInput(''); setSchoolSlugInput(''); setSchoolAddressInput('');
    }
    setBusy(false);
  }

  async function createSchoolAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || profile?.platform_role !== 'super_admin' || !adminSchoolId) return;
    setBusy(true); setError(''); setCreatedAdmin(null);
    const { data, error: invokeError } = await client.functions.invoke('create-school-admin', {
      body: { schoolId: adminSchoolId, fullName: adminFullName.trim(), phone: adminPhone.trim() },
    });
    if (invokeError || !data?.success || !data?.temporaryPassword) {
      setError(data?.error || invokeError?.message || 'Could not create this school administrator. Please try again.');
    } else {
      setCreatedAdmin({
        fullName: data.administrator.fullName,
        phone: data.administrator.phone,
        temporaryPassword: data.temporaryPassword,
      });
      setAdminFullName(''); setAdminPhone('');
    }
    setBusy(false);
  }

  async function toggleSchoolStatus(school: School) {
    if (!client || profile?.platform_role !== 'super_admin') return;
    setBusy(true); setError('');
    const nextStatus = school.status === 'active' ? 'suspended' : 'active';
    const { data, error: updateError } = await client.from('schools').update({ status: nextStatus }).eq('id', school.id).select('id,name,slug,address,status,created_at').single();
    if (updateError) setError('Could not update this school status. Please try again.');
    else if (data) setSchools((current) => current.map((item) => item.id === school.id ? data as School : item));
    setBusy(false);
  }

  async function signOut() {
    if (!client) return;
    setBusy(true); await client.auth.signOut(); setBusy(false);
  }

  if (!isSupabaseConfigured || !client) {
    return <main className="auth-shell"><Brand /><section className="auth-card setup-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">INITIAL SETUP</p><h1>Connect TagIn to your school workspace.</h1><p className="muted">The application is ready. Add the Supabase project URL and public publishable key to your local environment to enable secure sign-in.</p><div className="code-note">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, then fill in the two Vite environment variables.</div></section></main>;
  }
  if (loading) return <main className="auth-shell"><Brand /><div className="loading-card">Loading your secure school workspace…</div></main>;

  if (!session && !showSignIn) return <PublicLandingPage onSignIn={() => setShowSignIn(true)} />;
  if (!session) {
    return <main className="auth-shell"><Brand /><button className="login-home-link" type="button" onClick={() => setShowSignIn(false)}>← Back to TagIn home</button><section className="auth-card"><div className="auth-icon"><QrCode size={25} /></div><p className="eyebrow">WELCOME TO TAGIN</p><h1>Sign in to your school account.</h1><p className="muted">Enter your phone number as usual (for example, 08012345678) and the password provided by your school.</p><form className="auth-form" onSubmit={signIn}><label htmlFor="phone">Phone number</label><input id="phone" type="tel" autoComplete="tel" placeholder="08012345678" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required /><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}<span>{showPassword ? "Hide" : "Show"}</span></button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button></form><p className="login-reset-note">Forgot your password? Contact your school administrator. TagIn account recovery does not require SMS.</p></section><p className="security-note"><ShieldCheck size={14} /> Your school data is protected by role-based access controls.</p></main>;
  }
  if (profile?.must_change_password) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">SECURITY CHECK</p><h1>Create your new password.</h1><p className="muted">For your protection, change the temporary password before continuing.</p><form className="auth-form" onSubmit={changePassword}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={17} /></button></form></section></main>;
  }
  if (!profile) return <main className="auth-shell"><Brand /><section className="auth-card"><h1>Account setup incomplete.</h1><p className="muted">{error || 'Please contact your school administrator.'}</p><button className="secondary-button" onClick={signOut}>Sign out</button></section></main>;

  const isPlatformAdmin = profile.platform_role === 'super_admin';
  const isSchoolAdmin = selectedMembership?.role === 'school_admin';
  const isUnifiedStaff = selectedMembership?.role === 'staff';
  const isParent = selectedMembership?.role === 'parent' || guardianSchoolIds.length > 0;
  const hasStaffPermission = (permission: string) => staffPermissions.includes(permission);
  const canCheckIn = Boolean(selectedMembership && (isSchoolAdmin || selectedMembership.role === 'gate_staff' || (isUnifiedStaff && (hasStaffPermission('gate.scan') || hasStaffPermission('gate.check_in')))));
  const canCheckOut = Boolean(selectedMembership && (isSchoolAdmin || selectedMembership.role === 'gate_staff' || (isUnifiedStaff && (hasStaffPermission('gate.scan') || hasStaffPermission('gate.check_out')))));
  const role = isPlatformAdmin
    ? 'Platform administrator'
    : isParent
      ? 'Parent / guardian'
      : isUnifiedStaff
        ? `School staff · ${staffJobTitle}`
        : selectedMembership?.role?.replaceAll('_', ' ') ?? 'School member';
  const schoolName = selectedMembership?.schools?.name ?? (isPlatformAdmin ? 'All schools' : 'No active school');
  return <main className="workspace-shell">
    <header className="workspace-topbar"><Brand /><div className="account-actions">{!isSchoolAdmin && <span className="user-chip">{profile.full_name}</span>}<button className="icon-button" onClick={signOut} disabled={busy} aria-label="Sign out"><LogOut size={18} /></button></div></header>
    {activeWorkspace === 'scores-admin' && isSchoolAdmin && selectedMembership ? (
      <ScoresWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="admin" userId={session?.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'scores-teacher' && selectedMembership?.role === 'staff' ? (
      <ScoresWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="teacher" membershipId={selectedMembership.id} userId={session?.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'scores-parent' && isParent && session && (selectedMembership?.school_id || guardianSchoolIds[0]) ? (
      <ScoresWorkspace client={client!} schoolId={selectedMembership?.school_id ?? guardianSchoolIds[0]} schoolName={selectedMembership?.schools?.name ?? 'Your school'} mode="parent" userId={session.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'timetable-admin' && isSchoolAdmin && selectedMembership ? (
      <TimetableWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="admin" userId={session?.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'timetable-teacher' && selectedMembership?.role === 'staff' ? (
      <TimetableWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="teacher" membershipId={selectedMembership.id} userId={session?.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'timetable-parent' && isParent && session && (selectedMembership?.school_id || guardianSchoolIds[0]) ? (
      <TimetableWorkspace client={client!} schoolId={selectedMembership?.school_id ?? guardianSchoolIds[0]} schoolName={selectedMembership?.schools?.name ?? 'Your school'} mode="parent" userId={session.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'transport-admin' && isSchoolAdmin && selectedMembership ? (
      <TransportWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="admin" onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'transport-driver' && selectedMembership?.role === 'bus_staff' ? (
      <TransportWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} mode="driver" membershipId={selectedMembership.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'families' && isSchoolAdmin && selectedMembership ? (
      <FamilyWorkspace client={client!} mode="admin" schoolId={selectedMembership.school_id} schoolName={schoolName} userId={session?.user.id ?? ''} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'family' && isParent && session ? (
      <FamilyWorkspace client={client!} mode="parent" userId={session.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'staff' && isSchoolAdmin && selectedMembership ? (
      <StaffWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={schoolName} onBack={() => setActiveWorkspace('')} />
    ) : (activeWorkspace === 'attendance' || activeWorkspace === 'attendance-scan') && selectedMembership && session ? (
      <AttendanceWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={selectedMembership.schools?.name ?? 'Your school'} actorName={profile.full_name} canCheckIn={canCheckIn} canCheckOut={canCheckOut} startInScanMode={activeWorkspace === 'attendance-scan'} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'students-advanced' && isSchoolAdmin && selectedMembership && session ? (
      <AdvancedStudentWorkspace client={client!} schoolId={selectedMembership.school_id} schoolName={selectedMembership.schools?.name ?? 'Your school'} userId={session.user.id} onBack={() => setActiveWorkspace('')} />
    ) : activeWorkspace === 'students' && isSchoolAdmin && selectedMembership ? (
      <StudentDirectory client={client!} schoolId={selectedMembership.school_id} schoolName={selectedMembership.schools?.name ?? 'Your school'} onBack={() => setActiveWorkspace('')} />
    ) : showSchoolManagement && isPlatformAdmin ? (
      <section className="management-panel management-page">
        <div className="management-heading"><div><p className="eyebrow">PLATFORM ADMINISTRATION</p><h1>School management</h1><p className="muted">Create school workspaces and manage their access status.</p></div><button className="secondary-button" type="button" onClick={() => { setError(''); setShowSchoolManagement(false); }}>Back to dashboard</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="school-create-form" onSubmit={createSchool}><h3>Create a school</h3><label htmlFor="school-name">School name</label><input id="school-name" value={schoolNameInput} onChange={(event) => setSchoolNameInput(event.target.value)} placeholder="e.g. Greenfield Academy" required minLength={2} maxLength={160} /><label htmlFor="school-slug">School URL slug</label><input id="school-slug" value={schoolSlugInput} onChange={(event) => setSchoolSlugInput(event.target.value)} placeholder="greenfield-academy" pattern="[a-z0-9]+(-[a-z0-9]+)*" required /><label htmlFor="school-address">Address (optional)</label><input id="school-address" value={schoolAddressInput} onChange={(event) => setSchoolAddressInput(event.target.value)} placeholder="School address" /><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create school'} <ArrowRight size={17} /></button></form>
        <div className="school-list-heading"><h3>Registered schools</h3><span>{schools.length} total</span></div>
        {schools.length === 0 ? <p className="empty-state">No schools have been created yet.</p> : <div className="school-list">{schools.map((school) => <article className="school-entry" key={school.id}><div className="school-row"><div><strong>{school.name}</strong><span>/{school.slug}{school.address ? ` · ${school.address}` : ''}</span></div><div className="school-row-actions"><span className={`status-pill ${school.status}`}>{school.status}</span><button className="secondary-button" type="button" disabled={busy} onClick={() => void toggleSchoolStatus(school)}>{school.status === 'active' ? 'Suspend' : 'Reactivate'}</button>{school.status === 'active' && <button className="secondary-button" type="button" disabled={busy} onClick={() => { setAdminSchoolId(adminSchoolId === school.id ? '' : school.id); setCreatedAdmin(null); setError(''); }}>{adminSchoolId === school.id ? 'Close' : 'Assign admin'}</button>}</div></div>{adminSchoolId === school.id && <form className="school-create-form school-admin-form" onSubmit={createSchoolAdmin}><h3>Assign school administrator</h3><p className="muted">Create a secure login for {school.name}. The administrator will change the temporary password at first sign-in.</p><label htmlFor={`admin-name-${school.id}`}>Administrator full name</label><input id={`admin-name-${school.id}`} value={adminFullName} onChange={(event) => setAdminFullName(event.target.value)} placeholder="Full name" required minLength={2} maxLength={160} /><label htmlFor={`admin-phone-${school.id}`}>Phone number</label><input id={`admin-phone-${school.id}`} type="tel" inputMode="tel" value={adminPhone} onChange={(event) => setAdminPhone(event.target.value)} placeholder="08012345678 or +2348012345678" required /><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create school administrator'} <ArrowRight size={17} /></button>{createdAdmin && <div className="code-note"><strong>Administrator account created</strong><br />Name: {createdAdmin.fullName}<br />Phone: {createdAdmin.phone}<br />Temporary password: <strong>{createdAdmin.temporaryPassword}</strong><br /><span>Share this password privately. It will not be shown again after you leave this screen.</span></div>}</form>}</article>)}</div>}
      </section>
    ) : (
      <>
        <section className={`welcome-panel ${isSchoolAdmin ? 'school-admin-welcome' : ''}`}>{isSchoolAdmin ? <><div className="school-identity-copy"><p className="eyebrow">SCHOOL WORKSPACE</p><h1>{schoolName}</h1><p className="school-admin-name">{profile.full_name}</p><p className="school-admin-role">School Admin</p></div><div className="welcome-mark school-identity-mark"><GraduationCap size={46} /></div></> : <><div><p className="eyebrow">YOUR TAGIN WORKSPACE</p><h1>Hello, {profile.full_name.split(' ')[0]}.</h1><p className="muted">Your school day, connected.</p></div><div className="welcome-mark"><GraduationCap size={42} /></div></>}</section>
        {!isSchoolAdmin && <section className="workspace-meta"><div><span className="meta-label">ACCESS LEVEL</span><strong>{role}</strong></div><div><span className="meta-label">SCHOOL</span>{memberships.length > 1 ? <select aria-label="Select school" value={selectedMembership?.school_id ?? ""} onChange={(event) => setSchoolId(event.target.value)}>{memberships.map((item) => <option key={item.school_id} value={item.school_id}>{item.schools?.name ?? item.school_id}</option>)}</select> : <strong>{schoolName}</strong>}</div></section>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="workspace-section"><p className="eyebrow">YOUR WORKSPACE</p><h2>{isPlatformAdmin ? 'Platform overview' : 'School operations'}</h2><div className="workspace-grid">
          {isPlatformAdmin && <WorkspaceCard icon={<ShieldCheck />} title="School management" description="Create and manage school workspaces and administrators." actionLabel="Manage schools" onAction={() => { setError(''); setShowSchoolManagement(true); }} />}
          {isSchoolAdmin && <WorkspaceCard icon={<ShieldCheck />} title="Advanced student records" description="Manage private student profiles, emergency contacts, medical alerts and confidential incident follow-up." actionLabel="Open private records" onAction={() => setActiveWorkspace('students-advanced')} />}
          {(isPlatformAdmin || isSchoolAdmin || (isUnifiedStaff && (hasStaffPermission('students.create') || hasStaffPermission('students.update') || hasStaffPermission('registers.manage')))) && <WorkspaceCard icon={<Users />} title={isUnifiedStaff ? 'Student registers' : 'Students'} description={isUnifiedStaff ? 'View the student records and class registers assigned to you.' : 'Manage student records and school registers.'} actionLabel="Manage students" onAction={isSchoolAdmin ? () => setActiveWorkspace('students') : undefined} />}
          {isSchoolAdmin && <WorkspaceCard icon={<Users />} title="Staff management" description="Create teacher and gate staff accounts, manage access and review staff permissions." actionLabel="Manage staff" onAction={() => setActiveWorkspace('staff')} />}
          {isSchoolAdmin && <WorkspaceCard icon={<HeartHandshake />} title="Parents and guardians" description="Create parent logins and securely link each family to its student records." actionLabel="Manage families" onAction={() => setActiveWorkspace('families')} />}
          {(isSchoolAdmin || selectedMembership?.role === 'gate_staff' || isUnifiedStaff && (hasStaffPermission('gate.scan') || hasStaffPermission('gate.check_in') || hasStaffPermission('gate.check_out'))) && <WorkspaceCard icon={<QrCode />} title="Scan QR Code" description="Open your camera, scan a student’s secure TagIn code and record school arrival or departure." actionLabel="Open QR scanner" onAction={() => setActiveWorkspace('attendance-scan')} />}
          {isSchoolAdmin && <WorkspaceCard icon={<Award />} title="Scores & assessments" description="Create assessments, manage class scores and publish results to parents." actionLabel="Manage assessments" onAction={() => setActiveWorkspace('scores-admin')} />}
          {selectedMembership?.role === 'staff' && <WorkspaceCard icon={<Award />} title="My assessments" description="Enter scores for assessments assigned to your teacher account." actionLabel="Open assessments" onAction={() => setActiveWorkspace('scores-teacher')} />}
          {isSchoolAdmin && <WorkspaceCard icon={<ClipboardList />} title="Timetable management" description="Create weekly class schedules, assign teachers and organise lesson times." actionLabel="Manage timetable" onAction={() => setActiveWorkspace('timetable-admin')} />}
          {isUnifiedStaff && <WorkspaceCard icon={<ClipboardList />} title="My teaching timetable" description="View the lessons assigned to your teacher account." actionLabel="View timetable" onAction={() => setActiveWorkspace('timetable-teacher')} />}
          {isSchoolAdmin && <WorkspaceCard icon={<BusFront />} title="Transport management" description="Manage school vehicles, routes, stops, drivers and student allocations." actionLabel="Manage transport" onAction={() => setActiveWorkspace('transport-admin')} />}
          {selectedMembership?.role === 'bus_staff' && <WorkspaceCard icon={<BusFront />} title="My transport journeys" description="View your assigned routes and record student pickup and drop-off." actionLabel="Open driver workspace" onAction={() => setActiveWorkspace('transport-driver')} />}
          {(isPlatformAdmin || isSchoolAdmin) && <WorkspaceCard icon={<ClipboardList />} title="Reports and overview" description="Review attendance, school activity, and operational reports." />}
          {isParent && (selectedMembership?.role === 'parent' || guardianSchoolIds.length > 0) && <WorkspaceCard icon={<Award />} title="Children's results" description="View published assessment scores and teacher remarks for your linked children." actionLabel="View results" onAction={() => setActiveWorkspace('scores-parent')} />}
          {isParent && (selectedMembership?.role === 'parent' || guardianSchoolIds.length > 0) && <WorkspaceCard icon={<CalendarDays />} title="Children's timetable" description="View the weekly class schedule for your linked children." actionLabel="View timetable" onAction={() => setActiveWorkspace('timetable-parent')} />}
          {isParent && <WorkspaceCard icon={<Bell />} title="Family updates" description="View your linked children's school arrival, departure, and attendance notifications." actionLabel="Open family portal" onAction={() => setActiveWorkspace('family')} />}
          {!isPlatformAdmin && !selectedMembership && !isParent && <WorkspaceCard icon={<ShieldCheck />} title="No school assigned" description="Your account is active, but no active school membership was found. Contact your administrator." />}
        </div></section>
      </>
    )}
    <footer className="workspace-footer"><span>TagIn · Safer school journeys</span><span><CheckCircle2 size={14} /> Secure session</span></footer>
  </main>;
}

function Brand() {
  return <a className="brand" href="#top" aria-label="TagIn home">
    <img className="brand-logo" src="/tagin-logo.svg" alt="TagIn" />
  </a>;
}
function WorkspaceCard({ icon, title, description, actionLabel, onAction }: { icon: ReactNode; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <article className="workspace-card"><div className="workspace-card-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{onAction ? <button className="module-action" type="button" onClick={onAction}>{actionLabel ?? 'Open module'} <ArrowRight size={14} /></button> : <span className="coming-soon">MODULE IN DEVELOPMENT</span>}</article>;
}
