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

function studentFor(row: AuditRow, students: Record<string,{name:string;className:string}>, tagStudents:Record<string,string>) {
 const m=row.metadata??{}; const after=(m.after&&typeof m.after==='object'?m.after:{}) as Record<string,unknown>; const before=(m.before&&typeof m.before==='object'?m.before:{}) as Record<string,unknown>;
 const id=[after.student_id,before.student_id,row.entity_type==='students'?row.entity_id:null,row.entity_type==='tags'&&row.entity_id?tagStudents[row.entity_id]:null].find(v=>typeof v==='string') as string|undefined;
 return id?students[id]:undefined;
}
function friendlyEntity(value:string) {
 const map:Record<string,string>={tags:'QR tag',students:'student record',guardians:'parent/guardian record',student_guardians:'parent–student link',school_memberships:'staff or user access',profiles:'user profile',staff_profiles:'staff profile',staff_permissions:'staff permissions',scan_events:'attendance record',authorized_collectors:'pickup authorisation',schools:'school record',assessment_scores:'student result',assessments:'assessment',timetable_entries:'timetable',transport_events:'transport update',notifications:'notification'};
 return map[value]??value.replaceAll('_',' ');
}
function describe(row:AuditRow, students:Record<string,{name:string;className:string}>, tagStudents:Record<string,string>) {
 const action=row.action.toLowerCase(), child=studentFor(row,students,tagStudents)?.name;
 if(action==='tags.update' && (row.metadata?.after as Record<string,unknown>|undefined)?.status==='revoked') return child ? 'Revoked '+child+"'s QR tag" : 'Revoked a QR tag';
 if(action==='tags.insert') return child ? 'Issued a QR tag for '+child : 'Issued a QR tag';
 if(action==='parent.linked') {const m=row.metadata??{};return 'Linked '+String(m.parent_name??'a parent')+' to '+String(m.student_name??'a student');}
 if(action==='activity.exported') return 'Downloaded an activity report';
 if(action==='auth.login_failed') return 'Failed login attempt'; if(action==='auth.login_blocked') return 'Blocked login attempt'; if(action==='auth.login') return 'Signed in to TagIn'; if(action==='auth.logout') return 'Signed out of TagIn';
 const op=action.split('.').pop()??'updated'; const verbs:Record<string,string>={insert:'created',update:'updated',delete:'deleted',created:'created',updated:'updated',deleted:'deleted',linked:'linked',export_failed:'failed to download'};
 return (verbs[op]??op)+' '+friendlyEntity(row.entity_type);
}
function changedSummary(row:AuditRow) {
 const m=row.metadata??{}; const fields=Array.isArray(m.changed_fields)?m.changed_fields.filter(x=>typeof x==='string'&&x!=='id'&&x!=='student_id'):[];
 return fields.length?'Changed: '+fields.map(x=>String(x).replaceAll('_',' ')).join(', '):'Activity recorded';
}
function safeDetails(row:AuditRow,students:Record<string,{name:string;className:string}>,tagStudents:Record<string,string>) {
 const m=row.metadata??{}; const after=(m.after&&typeof m.after==='object'?m.after:{}) as Record<string,unknown>; const before=(m.before&&typeof m.before==='object'?m.before:{}) as Record<string,unknown>; const parts:string[]=[]; const student=studentFor(row,students,tagStudents);
 if(student) parts.push('Student: '+student.name+(student.className?' · '+student.className:''));
 for(const key of ['status','tag_type','role','relationship','is_primary','collected_by_type','collected_by_name','event_type','active']) if(before[key]!==undefined||after[key]!==undefined) parts.push(key.replaceAll('_',' ')+': '+(before[key]===undefined?'—':String(before[key]))+' → '+(after[key]===undefined?'—':String(after[key])));
 if(typeof m.reason==='string') parts.push('Reason: '+m.reason.replaceAll('_',' '));
 return parts.length?parts.join(' · '):changedSummary(row);
}

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
  const [students, setStudents] = useState<Record<string, {name:string; className:string}>>({});
  const [tagStudents, setTagStudents] = useState<Record<string,string>>({});
  const [downloadUrl, setDownloadUrl] = useState('');

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
    const studentIds = [...new Set(nextRows.flatMap(row => { const m=row.metadata ?? {}; const a=(m.after && typeof m.after==='object' ? m.after : {}) as Record<string,unknown>; const b=(m.before && typeof m.before==='object' ? m.before : {}) as Record<string,unknown>; return [a.student_id,b.student_id,row.entity_type==='students'?row.entity_id:null].filter((id): id is string => typeof id==='string' && /^[0-9a-f-]{36}$/i.test(id)); }))];
    const tagIds = [...new Set(nextRows.filter(row=>row.entity_type==='tags' && row.entity_id).map(row=>row.entity_id as string))];
    const [schoolResult, actorResult, studentResult, tagResult] = await Promise.all([
      schoolIds.length ? client.from('schools').select('id,name').in('id', schoolIds) : Promise.resolve({ data: [], error: null }),
      actorIds.length ? client.from('profiles').select('id,full_name').in('id', actorIds) : Promise.resolve({ data: [], error: null }),
      studentIds.length ? client.from('students').select('id,full_name,class_name').in('id', studentIds) : Promise.resolve({ data: [], error: null }),
      tagIds.length ? client.from('tags').select('id,student_id').in('id', tagIds) : Promise.resolve({ data: [], error: null }),
    ]);
    setSchools(Object.fromEntries((schoolResult.data ?? []).map((item: {id:string;name:string}) => [item.id,item.name])));
    setActors(Object.fromEntries((actorResult.data ?? []).map((item: {id:string;full_name:string}) => [item.id,item.full_name])));
    setStudents(Object.fromEntries((studentResult.data ?? []).map((item: {id:string;full_name:string;class_name:string|null}) => [item.id,{name:item.full_name,className:item.class_name ?? ''}])));
    setTagStudents(Object.fromEntries((tagResult.data ?? []).map((item: {id:string;student_id:string}) => [item.id,item.student_id])));
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
  }), [rows, selectedSchool, category, fromDate, toDate, search, actors, schools, platformAdmin, students, tagStudents]);

  async function exportCsv() {
    if (!session.user.email) { setError('This account has no email sign-in identity available for password verification. Export is blocked for security.'); return; }
    if (!password) { setError('Enter your current login password to export this report.'); return; }
    setExporting(true); setError(''); setNotice('');
    const { error: verifyError } = await client.auth.signInWithPassword({ email: session.user.email, password });
    if (verifyError) {
      await client.rpc('record_audit_export_attempt', { p_school_id: platformAdmin ? (selectedSchool || null) : (schoolId ?? null), p_format: 'csv', p_record_count: filtered.length, p_filters: { category, from: fromDate || null, to: toDate || null }, p_success: false });
      setError('Password verification failed. No report was downloaded.');
      setExporting(false);
      return;
    }
    const { error: auditError } = await client.rpc('record_audit_export_attempt', {
      p_school_id: platformAdmin ? (selectedSchool || null) : (schoolId ?? null),
      p_format: 'csv',
      p_record_count: filtered.length,
      p_filters: { category, from: fromDate || null, to: toDate || null },
      p_success: true,
    });
    if (auditError) {
      setError('The export could not be recorded in the audit trail, so the report was not downloaded.');
      setExporting(false);
      return;
    }
    const headers = ['Date and time','School','Person','Activity','Student','Class','What changed','Details'];
    const lines = filtered.map(row => [
      new Date(row.created_at).toLocaleString(), row.school_id ? schools[row.school_id] ?? 'School' : 'Platform',
      row.actor_user_id ? actors[row.actor_user_id] ?? 'Account name unavailable' : (typeof row.metadata?.attempted_name === 'string' ? 'Failed sign-in attempt for ' + row.metadata.attempted_name : 'System / automated action'),
      describe(row, students, tagStudents), studentFor(row, students, tagStudents)?.name ?? '', studentFor(row, students, tagStudents)?.className ?? '', changedSummary(row), safeDetails(row, students, tagStudents),
    ].map(csvCell).join(','));
    const csv = '\uFEFF' + [headers.map(csvCell).join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(url);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'tagin-activity-audit-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setPassword(''); setShowVerify(false); setNotice('Your report is ready. If it did not save automatically, tap the download link below.');
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
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="student-notice" role="status">{notice}</p>}{downloadUrl && <p className="audit-download-ready"><Download size={16}/> <a href={downloadUrl} download={'tagin-activity-audit-' + new Date().toISOString().slice(0,10) + '.csv'}>Tap here to download your activity report</a></p>}
    <div className="audit-list">
      {loading ? <p className="audit-empty">Loading activity records…</p> : filtered.length === 0 ? <p className="audit-empty">No activity matches these filters.</p> : filtered.map(row=><article className="audit-row" key={row.id}>
        <div className="audit-row-main"><span className="audit-action-icon"><Filter size={16}/></span><div className="audit-row-copy"><strong>{describe(row, students)}</strong><span>{row.actor_user_id ? actors[row.actor_user_id] ?? 'Account name unavailable' : (typeof row.metadata?.attempted_name === 'string' ? 'Failed sign-in attempt · ' + row.metadata.attempted_name : 'System / automated action')} · {row.school_id ? schools[row.school_id] ?? 'School' : 'Platform'}</span><small>{studentFor(row, students) ? studentFor(row, students, tagStudents)!.name + (studentFor(row, students, tagStudents)!.className ? ' · ' + studentFor(row, students)!.className : '') : friendlyEntity(row.entity_type)}</small></div></div>
        <time>{new Date(row.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</time>
        {row.metadata && Object.keys(row.metadata).length>0 && <details className="audit-details"><summary>View details</summary><div className="audit-human-details"><strong>{changedSummary(row)}</strong><p>{safeDetails(row, students)}</p></div></details>}
      </article>)}
    </div>
    <p className="audit-footnote">Audit history is read-only here. Activity records are stored separately from attendance records and cannot be edited from this screen.</p>
  </section>;
}
