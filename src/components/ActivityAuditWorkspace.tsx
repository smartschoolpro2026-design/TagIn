import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Filter, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

type AuditRow = {
  id: number;
  school_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type Props = {
  client: SupabaseClient;
  session: Session;
  schoolId?: string;
  schoolName?: string;
  platformAdmin: boolean;
  onBack: () => void;
};
const label = (value: string) => value.replaceAll('.', ' · ').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const csvCell = (value: unknown) => {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return '"' + text.replaceAll('"', '""').replace(/[\r\n]+/g, ' ') + '"';
};

export function ActivityAuditWorkspace({ client, session, schoolId, schoolName, platformAdmin, onBack }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [schools, setSchools] = useState<Record<string, string>>({});
  const [actors, setActors] = useState<Record<string, string>>({});
  const [selectedSchool, setSelectedSchool] = useState(schoolId ?? '');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [password, setPassword] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true); setError(''); setNotice('');
    let query = client.from('audit_logs')
      .select('id,school_id,actor_user_id,action,entity_type,entity_id,metadata,created_at')
      .order('created_at', { ascending: false }).limit(2000);
    if (!platformAdmin && schoolId) query = query.eq('school_id', schoolId);
    const { data, error: queryError } = await query;
    if (queryError) { setError('Activity records could not be loaded. Check your access and try again.'); setRows([]); setLoading(false); return; }
    const nextRows = (data ?? []) as AuditRow[];
    setRows(nextRows);
    const schoolIds = [...new Set(nextRows.map(row => row.school_id).filter((id): id is string => Boolean(id)))];
    const actorIds = [...new Set(nextRows.map(row => row.actor_user_id).filter((id): id is string => Boolean(id)))];
    const [schoolResult, actorResult] = await Promise.all([
      schoolIds.length ? client.from('schools').select('id,name').in('id', schoolIds) : Promise.resolve({ data: [], error: null }),
      actorIds.length ? client.from('profiles').select('id,full_name').in('id', actorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    setSchools(Object.fromEntries((schoolResult.data ?? []).map((item: {id:string;name:string}) => [item.id,item.name])));
    setActors(Object.fromEntries((actorResult.data ?? []).map((item: {id:string;full_name:string}) => [item.id,item.full_name])));
    if (platformAdmin) {
      const { data: allSchools } = await client.from('schools').select('id,name').order('name');
      if (allSchools) setSchools(current => ({ ...current, ...Object.fromEntries(allSchools.map(item => [item.id,item.name])) }));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [schoolId, platformAdmin]);

  const filtered = useMemo(() => rows.filter(row => {
    if (platformAdmin && selectedSchool && row.school_id !== selectedSchool) return false;
    if (category !== 'all' && !row.action.toLowerCase().startsWith(category)) return false;
    const date = row.created_at.slice(0,10);
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    const haystack = [row.action,row.entity_type,row.entity_id,row.actor_user_id ? actors[row.actor_user_id] : 'System / automated action',row.school_id ? schools[row.school_id] : 'Platform',JSON.stringify(row.metadata ?? {})].join(' ').toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [rows, selectedSchool, category, fromDate, toDate, search, actors, schools, platformAdmin]);

  async function exportCsv() {
    if (!session.user.email) { setError('This account has no email sign-in identity available for password verification. Export is blocked for security.'); return; }
    if (!password) { setError('Enter your current login password to export this report.'); return; }
    setExporting(true); setError(''); setNotice('');
    const { error: verifyError } = await client.auth.signInWithPassword({ email: session.user.email, password });
    if (verifyError) {
      setError('Password verification failed. No report was downloaded.');
      setExporting(false);
      return;
    }
    const headers = ['Date and time (UTC)','School','Actor','Actor user ID','Action','Entity type','Entity reference','Details'];
    const lines = filtered.map(row => [
      row.created_at, row.school_id ? schools[row.school_id] ?? row.school_id : 'Platform',
      row.actor_user_id ? actors[row.actor_user_id] ?? 'Account name unavailable' : 'System / automated action',
      row.actor_user_id ?? '', row.action, row.entity_type, row.entity_id ?? '', row.metadata ?? {},
    ].map(csvCell).join(','));
    const csv = '\uFEFF' + [headers.map(csvCell).join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'tagin-activity-audit-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    setPassword(''); setShowVerify(false); setNotice('Your filtered activity report has been downloaded.');
    setExporting(false);
  }

  const categories = [...new Set(rows.map(row => row.action.split('.')[0]).filter(Boolean))].sort();
  return <section className="audit-page">
    <div className="audit-heading">
      <div><p className="eyebrow">{platformAdmin ? 'PLATFORM OVERSIGHT' : 'SCHOOL OVERSIGHT'}</p><h1>Activity &amp; Audit Centre</h1><p className="muted">{platformAdmin ? 'Review actions and changes across every TagIn school.' : 'Review actions and changes recorded in ' + (schoolName ?? 'your school') + '.'}</p></div>
      <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={16}/> Back</button>
    </div>
    <div className="audit-toolbar">
      <label className="audit-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people, actions or records…"/></label>
      {platformAdmin && <select aria-label="Filter by school" value={selectedSchool} onChange={e=>setSelectedSchool(e.target.value)}><option value="">All schools</option>{Object.entries(schools).sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>}
      <select aria-label="Filter by activity category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All activity types</option>{categories.map(item=><option key={item} value={item}>{label(item)}</option>)}</select>
      <label className="audit-date">From <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
      <label className="audit-date">To <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
      <button className="secondary-button" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      <button className="primary-button audit-export-button" type="button" onClick={()=>{setShowVerify(true);setError('');}} disabled={!filtered.length}><Download size={16}/> Export report</button>
    </div>
    <div className="audit-summary"><span><strong>{filtered.length.toLocaleString()}</strong> matching activities</span><span>{rows.length.toLocaleString()} records loaded · Latest 2,000</span></div>
    {showVerify && <form className="audit-verify" onSubmit={e=>{e.preventDefault();void exportCsv();}}><div><ShieldCheck size={22}/><div><strong>Confirm your identity</strong><p>Enter your current TagIn login password to export this activity report.</p></div></div><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Current login password" required/><button className="primary-button" type="submit" disabled={exporting}>{exporting?'Verifying…':'Verify and download'}</button><button className="secondary-button" type="button" onClick={()=>{setShowVerify(false);setPassword('');}}>Cancel</button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="student-notice" role="status">{notice}</p>}
    <div className="audit-list">
      {loading ? <p className="audit-empty">Loading activity records…</p> : filtered.length === 0 ? <p className="audit-empty">No activity matches these filters.</p> : filtered.map(row=><article className="audit-row" key={row.id}>
        <div className="audit-row-main"><span className="audit-action-icon"><Filter size={16}/></span><div className="audit-row-copy"><strong>{label(row.action)}</strong><span>{row.actor_user_id ? actors[row.actor_user_id] ?? 'Account name unavailable' : 'System / automated action'} · {row.school_id ? schools[row.school_id] ?? 'School' : 'Platform'}</span><small>{row.entity_type}{row.entity_id ? ' · ' + row.entity_id : ''}</small></div></div>
        <time>{new Date(row.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</time>
        {row.metadata && Object.keys(row.metadata).length>0 && <details className="audit-details"><summary>View details</summary><pre>{JSON.stringify(row.metadata,null,2)}</pre></details>}
      </article>)}
    </div>
    <p className="audit-footnote">Audit history is read-only here. Activity records are stored separately from attendance records and cannot be edited from this screen.</p>
  </section>;
}
