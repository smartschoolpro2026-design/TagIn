import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Bell, BusFront, CheckCircle2, GraduationCap, LogOut, QrCode, ShieldCheck, Users } from 'lucide-react';
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

export default function App() {
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

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setMemberships([]);
        setSchoolId('');
      }
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setProfile(null);
      setMemberships([]);
      setLoading(false);
      return;
    }
    let alive = true;
    const loadAccount = async () => {
      setLoading(true);
      setError('');
      const [profileResult, membershipsResult] = await Promise.all([
        supabase.from('profiles')
          .select('full_name, platform_role, is_active, must_change_password')
          .eq('id', session.user.id)
          .maybeSingle(),
        supabase.from('school_memberships')
          .select('school_id, role, status, schools(name, slug)')
          .eq('user_id', session.user.id)
          .eq('status', 'active'),
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
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({
      phone: phone.trim(),
      password,
    });
    if (authError) setError(authError.message.includes('Invalid login credentials')
      ? 'Phone number or password is incorrect.'
      : authError.message);
    setBusy(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 12) {
      setError('Choose a password with at least 12 characters.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: functionError } = await supabase.functions.invoke('change-password', {
      body: { newPassword },
    });
    if (functionError) {
      setError('Password could not be updated. Please try again or contact your administrator.');
    } else {
      setProfile((current) => current ? { ...current, must_change_password: false } : current);
      setNewPassword('');
    }
    setBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
  }

  if (!isSupabaseConfigured || !supabase) {
    return (
      <main className="auth-shell">
        <Brand />
        <section className="auth-card setup-card">
          <div className="auth-icon"><ShieldCheck size={25} /></div>
          <p className="eyebrow">INITIAL SETUP</p>
          <h1>Connect TagIn to your school workspace.</h1>
          <p className="muted">The application is ready. Add the Supabase project URL and public publishable key to your local environment to enable secure sign-in.</p>
          <div className="code-note">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, then fill in the two Vite environment variables.</div>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="auth-shell"><Brand /><div className="loading-card">Loading your secure school workspace…</div></main>;
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <Brand />
        <section className="auth-card">
          <div className="auth-icon"><QrCode size={25} /></div>
          <p className="eyebrow">WELCOME TO TAGIN</p>
          <h1>Sign in to your school account.</h1>
          <p className="muted">Use the phone number and password provided by your school.</p>
          <form className="auth-form" onSubmit={signIn}>
            <label htmlFor="phone">Phone number</label>
            <input id="phone" type="tel" autoComplete="tel" placeholder="+2348012345678" value={phone} onChange={(event) => setPhone(event.target.value)} required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button>
          </form>
          <p className="auth-footnote">Having trouble signing in? Contact your school administrator.</p>
        </section>
        <p className="security-note"><ShieldCheck size={14} /> Your school data is protected by role-based access controls.</p>
      </main>
    );
  }

  if (profile?.must_change_password) {
    return (
      <main className="auth-shell">
        <Brand />
        <section className="auth-card">
          <div className="auth-icon"><ShieldCheck size={25} /></div>
          <p className="eyebrow">SECURITY CHECK</p>
          <h1>Create your new password.</h1>
          <p className="muted">For your protection, change the temporary password before continuing.</p>
          <form className="auth-form" onSubmit={changePassword}>
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={17} /></button>
          </form>
        </section>
      </main>
    );
  }

  if (!profile) {
    return <main className="auth-shell"><Brand /><section className="auth-card"><h1>Account setup incomplete.</h1><p className="muted">{error || 'Please contact your school administrator.'}</p><button className="secondary-button" onClick={signOut}>Sign out</button></section></main>;
  }

  const isPlatformAdmin = profile.platform_role === 'super_admin';
  const role = isPlatformAdmin ? 'Platform administrator' : selectedMembership?.role?.replace('_', ' ') ?? 'School member';
  const schoolName = selectedMembership?.schools?.name ?? (isPlatformAdmin ? 'All schools' : 'No active school');

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar"><Brand /><div className="account-actions"><span className="user-chip">{profile.full_name}</span><button className="icon-button" onClick={signOut} disabled={busy} aria-label="Sign out"><LogOut size={18} /></button></div></header>
      <section className="welcome-panel">
        <div><p className="eyebrow">YOUR TAGIN WORKSPACE</p><h1>Hello, {profile.full_name.split(' ')[0]}.</h1><p className="muted">Your school day, connected.</p></div>
        <div className="welcome-mark"><GraduationCap size={42} /></div>
      </section>
      <section className="workspace-meta">
        <div><span className="meta-label">ACCESS LEVEL</span><strong>{role}</strong></div>
        <div><span className="meta-label">SCHOOL</span>{memberships.length > 1 ? <select aria-label="Select school" value={selectedMembership?.school_id ?? ''} onChange={(event) => setSchoolId(event.target.value)}>{memberships.map((item) => <option key={item.school_id} value={item.school_id}>{item.schools?.name ?? item.school_id}</option>)}</select> : <strong>{schoolName}</strong>}</div>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="workspace-section"><p className="eyebrow">YOUR WORKSPACE</p><h2>{isPlatformAdmin ? 'Platform overview' : 'School operations'}</h2>
        <div className="workspace-grid">
          {isPlatformAdmin && <WorkspaceCard icon={<ShieldCheck />} title="School management" description="Create and manage school workspaces and administrators." />}
          {(isPlatformAdmin || selectedMembership?.role === 'school_admin') && <WorkspaceCard icon={<Users />} title="People and students" description="Manage student records, families, and staff access." />}
          {(isPlatformAdmin || ['school_admin', 'gate_staff'].includes(selectedMembership?.role ?? '')) && <WorkspaceCard icon={<QrCode />} title="Gate check-in" description="Prepare secure student tag scanning and attendance workflows." />}
          {(isPlatformAdmin || ['school_admin', 'bus_staff'].includes(selectedMembership?.role ?? '')) && <WorkspaceCard icon={<BusFront />} title="Transport" description="Manage bus pickup, boarding, and drop-off workflows." />}
          {(isPlatformAdmin || selectedMembership?.role === 'parent') && <WorkspaceCard icon={<Bell />} title="Family updates" description="View your children's arrival, departure, and transport notifications." />}
          {!isPlatformAdmin && !selectedMembership && <WorkspaceCard icon={<ShieldCheck />} title="No school assigned" description="Your account is active, but no active school membership was found. Contact your administrator." />}
        </div>
      </section>
      <footer className="workspace-footer"><span>TagIn · Safer school journeys</span><span><CheckCircle2 size={14} /> Secure session</span></footer>
    </main>
  );
}

function Brand() {
  return <a className="brand" href="#top"><span className="brand-mark"><QrCode size={20} /></span><span>TagIn</span></a>;
}

function WorkspaceCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <article className="workspace-card"><div className="workspace-card-icon">{icon}</div><h3>{title}</h3><p>{description}</p><span className="coming-soon">FOUNDATION READY</span></article>;
}
