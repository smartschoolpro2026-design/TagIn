import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight, Bell, BusFront, CheckCircle2, ClipboardList, GraduationCap,
  Eye, EyeOff, LogOut, QrCode, ShieldCheck, Users,
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
  const [staffJobTitle, setStaffJobTitle] = useState('Staff member');
  const [staffPermissions, setStaffPermissions] = useState<string[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        supabaseClient.from('school_memberships').select('id, school_id, role, status, schools(name, slug)').eq('user_id', session.user.id).eq('status', 'active'),
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

  if (!isSupabaseConfigured || !client) {
    return <main className="auth-shell"><Brand /><section className="auth-card setup-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">INITIAL SETUP</p><h1>Connect TagIn to your school workspace.</h1><p className="muted">The application is ready. Add the Supabase project URL and public publishable key to your local environment to enable secure sign-in.</p><div className="code-note">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, then fill in the two Vite environment variables.</div></section></main>;
  }
  if (loading) return <main className="auth-shell"><Brand /><div className="loading-card">Loading your secure school workspace…</div></main>;

  if (!session) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><div className="auth-icon"><QrCode size={25} /></div><p className="eyebrow">WELCOME TO TAGIN</p><h1>Sign in to your school account.</h1><p className="muted">Enter your phone number as usual (for example, 08012345678) and the password provided by your school.</p><form className="auth-form" onSubmit={signIn}><label htmlFor="phone">Phone number</label><input id="phone" type="tel" autoComplete="tel" placeholder="08012345678" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required /><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}<span>{showPassword ? "Hide" : "Show"}</span></button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button></form></section><p className="security-note"><ShieldCheck size={14} /> Your school data is protected by role-based access controls.</p></main>;
  }
  if (profile?.must_change_password) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><div className="auth-icon"><ShieldCheck size={25} /></div><p className="eyebrow">SECURITY CHECK</p><h1>Create your new password.</h1><p className="muted">For your protection, change the temporary password before continuing.</p><form className="auth-form" onSubmit={changePassword}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={17} /></button></form></section></main>;
  }
  if (!profile) return <main className="auth-shell"><Brand /><section className="auth-card"><h1>Account setup incomplete.</h1><p className="muted">{error || 'Please contact your school administrator.'}</p><button className="secondary-button" onClick={signOut}>Sign out</button></section></main>;

  const isPlatformAdmin = profile.platform_role === 'super_admin';
  const isSchoolAdmin = selectedMembership?.role === 'school_admin';
  const isUnifiedStaff = selectedMembership?.role === 'staff';
  const hasStaffPermission = (permission: string) => staffPermissions.includes(permission);
  const role = isPlatformAdmin
    ? 'Platform administrator'
    : isUnifiedStaff
      ? `School staff · ${staffJobTitle}`
      : selectedMembership?.role?.replaceAll('_', ' ') ?? 'School member';
  const schoolName = selectedMembership?.schools?.name ?? (isPlatformAdmin ? 'All schools' : 'No active school');
  return <main className="workspace-shell"><header className="workspace-topbar"><Brand /><div className="account-actions"><span className="user-chip">{profile.full_name}</span><button className="icon-button" onClick={signOut} disabled={busy} aria-label="Sign out"><LogOut size={18} /></button></div></header><section className="welcome-panel"><div><p className="eyebrow">YOUR TAGIN WORKSPACE</p><h1>Hello, {profile.full_name.split(' ')[0]}.</h1><p className="muted">Your school day, connected.</p></div><div className="welcome-mark"><GraduationCap size={42} /></div></section><section className="workspace-meta"><div><span className="meta-label">ACCESS LEVEL</span><strong>{role}</strong></div><div><span className="meta-label">SCHOOL</span>{memberships.length > 1 ? <select aria-label="Select school" value={selectedMembership?.school_id ?? ''} onChange={(event) => setSchoolId(event.target.value)}>{memberships.map((item) => <option key={item.school_id} value={item.school_id}>{item.schools?.name ?? item.school_id}</option>)}</select> : <strong>{schoolName}</strong>}</div></section>{error && <p className="form-error" role="alert">{error}</p>}<section className="workspace-section"><p className="eyebrow">YOUR WORKSPACE</p><h2>{isPlatformAdmin ? 'Platform overview' : 'School operations'}</h2><div className="workspace-grid">{isPlatformAdmin && <WorkspaceCard icon={<ShieldCheck />} title="School management" description="Create and manage school workspaces and administrators." />}{(isPlatformAdmin || isSchoolAdmin || (isUnifiedStaff && (hasStaffPermission('students.create') || hasStaffPermission('students.update') || hasStaffPermission('registers.manage')))) && <WorkspaceCard icon={<Users />} title={isUnifiedStaff ? 'Student registers' : 'People and students'} description={isUnifiedStaff ? 'Manage the student records and class registers assigned to you.' : 'Manage student records, families, and staff access.'} />}{(isPlatformAdmin || isSchoolAdmin || (isUnifiedStaff && (hasStaffPermission('gate.scan') || hasStaffPermission('gate.check_in') || hasStaffPermission('gate.check_out'))) || selectedMembership?.role === 'gate_staff') && <WorkspaceCard icon={<QrCode />} title="Gate check-in" description="Scan student tags and record authorized arrival and departure activity." />}{(isPlatformAdmin || isSchoolAdmin || (isUnifiedStaff && (hasStaffPermission('transport.view_assigned') || hasStaffPermission('transport.board') || hasStaffPermission('transport.drop_off'))) || selectedMembership?.role === 'bus_staff') && <WorkspaceCard icon={<BusFront />} title="Transport" description="View assigned journeys and record student boarding and drop-off." />}{(isPlatformAdmin || isSchoolAdmin) && <WorkspaceCard icon={<ClipboardList />} title="Reports and overview" description="Review attendance, school activity, and operational reports." />}{(isPlatformAdmin || selectedMembership?.role === 'parent') && <WorkspaceCard icon={<Bell />} title="Family updates" description="View your children's arrival, departure, and transport notifications." />}{!isPlatformAdmin && !selectedMembership && <WorkspaceCard icon={<ShieldCheck />} title="No school assigned" description="Your account is active, but no active school membership was found. Contact your administrator." />}</div></section><footer className="workspace-footer"><span>TagIn · Safer school journeys</span><span><CheckCircle2 size={14} /> Secure session</span></footer></main>;
}

function Brand() { return <a className="brand" href="#top"><span className="brand-mark"><QrCode size={20}/></span><span>TagIn</span></a>; }
function WorkspaceCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <article className="workspace-card"><div className="workspace-card-icon">{icon}</div><h3>{title}</h3><p>{description}</p><span className="coming-soon">MODULE IN DEVELOPMENT</span></article>;
}
