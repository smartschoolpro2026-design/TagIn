import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, Plus, QrCode, Users } from 'lucide-react';

type SchoolClass = { id: string; class_name: string; level: string; teacher_membership_id: string | null; created_at: string };
type Teacher = { id: string; user_id: string; profiles: { full_name: string } | { full_name: string }[] | null };
type Student = { id: string; full_name: string; class_id: string | null; class_name: string | null; level: string | null; active: boolean };
type Props = { client: SupabaseClient; schoolId: string; schoolName: string; userId: string; onBack: () => void; onOpenStudents: () => void };

export function ClassManagementWorkspace({ client, schoolId, schoolName, userId, onBack, onOpenStudents }: Props) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [className, setClassName] = useState('');
  const [level, setLevel] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true); setError('');
    const [c, t, s] = await Promise.all([
      client.from('school_classes').select('id,class_name,level,teacher_membership_id,created_at').eq('school_id', schoolId).order('class_name'),
      client.from('school_memberships').select('id,user_id,profiles(full_name)').eq('school_id', schoolId).eq('role', 'staff').eq('status', 'active').order('created_at'),
      client.from('students').select('id,full_name,class_id,class_name,level,active').eq('school_id', schoolId).order('full_name')
    ]);
    if (c.error || t.error || s.error) setError('Classes, teachers or student registers could not be loaded. Please refresh and try again.');
    else { setClasses((c.data ?? []) as SchoolClass[]); setTeachers((t.data ?? []) as unknown as Teacher[]); setStudents((s.data ?? []) as Student[]); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [client, schoolId]);
  useEffect(() => {
    const channel = client.channel('school-class-management-' + schoolId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_classes', filter: 'school_id=eq.' + schoolId }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: 'school_id=eq.' + schoolId }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_memberships', filter: 'school_id=eq.' + schoolId }, () => { void load(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, schoolId]);

  function teacherName(membershipId: string | null) {
    const teacher = teachers.find(item => item.id === membershipId);
    const profile = Array.isArray(teacher?.profiles) ? teacher?.profiles[0] : teacher?.profiles;
    return profile?.full_name ?? 'Not assigned';
  }
  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const name = className.trim(); if (!name) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error: e } = await client.from('school_classes').insert({ school_id: schoolId, class_name: name, level: level.trim(), created_by: userId }).select('id,class_name,level,teacher_membership_id,created_at').single();
    if (e) setError(e.code === '23505' ? 'This class already exists in the selected level.' : 'The class could not be created. Please try again.');
    else if (data) { setClasses(old => [...old, data as SchoolClass].sort((a,b) => a.class_name.localeCompare(b.class_name))); setClassName(''); setLevel(''); setShowForm(false); setNotice('Class created. You can now assign its class teacher.'); }
    setBusy(false);
  }
  async function assignTeacher(item: SchoolClass, teacherMembershipId: string) {
    setBusy(true); setError(''); setNotice('');
    const { data, error: e } = await client.from('school_classes').update({ teacher_membership_id: teacherMembershipId || null, updated_at: new Date().toISOString() }).eq('id', item.id).eq('school_id', schoolId).select('id,class_name,level,teacher_membership_id,created_at').single();
    if (e) setError('The class teacher could not be assigned. Please try again.');
    else if (data) { setClasses(old => old.map(row => row.id === item.id ? data as SchoolClass : row)); setNotice(teacherMembershipId ? 'Class teacher assigned. The class will now appear in that teacher’s workspace.' : 'Class teacher assignment removed.'); }
    setBusy(false);
  }

  return <section className="class-management-workspace">
    <div className="class-management-heading"><div><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">SCHOOL OPERATIONS · {schoolName}</p><h1>Classes and class teachers</h1><p className="muted">Create class registers, assign each class teacher and monitor the students entered by teachers.</p></div><div className="class-management-actions"><button className="secondary-button" type="button" onClick={onOpenStudents}><QrCode size={16}/> Student register & QR codes</button><button className="primary-button" type="button" onClick={() => { setShowForm(v => !v); setError(''); }}><Plus size={16}/>{showForm ? 'Close' : 'Create class'}</button></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="student-notice" role="status">{notice}</p>}
    {showForm && <form className="class-create-form" onSubmit={createClass}><h2>Create a class</h2><div><label htmlFor="new-class-name">Class name</label><input id="new-class-name" value={className} onChange={e => setClassName(e.target.value)} placeholder="e.g. Primary 4" required maxLength={80}/></div><div><label htmlFor="new-class-level">Level / section</label><input id="new-class-level" value={level} onChange={e => setLevel(e.target.value)} placeholder="e.g. Blue (optional)" maxLength={80}/></div><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create class'}</button></form>}
    <div className="class-management-summary"><article><span>Total classes</span><strong>{classes.length}</strong></article><article><span>Assigned class teachers</span><strong>{classes.filter(item => item.teacher_membership_id).length}</strong></article><article><span>Registered students</span><strong>{students.length}</strong></article></div>
    {loading ? <p className="empty-state">Loading class registers…</p> : classes.length === 0 ? <div className="teacher-empty"><BookOpen size={30}/><h2>No classes created yet</h2><p>Create the school's first class, then assign its class teacher.</p></div> : <div className="school-class-grid">{classes.map(item => { const roster = students.filter(s => s.class_id === item.id || (!s.class_id && s.class_name === item.class_name && (s.level ?? '') === item.level)); return <article className="school-class-card" key={item.id}><div className="school-class-card-heading"><span className="class-card-icon"><BookOpen size={19}/></span><div><h2>{item.class_name}</h2><p>{item.level || 'General class'}</p></div><strong>{roster.length} students</strong></div><label htmlFor={'class-teacher-'+item.id}>Class teacher</label><select id={'class-teacher-'+item.id} value={item.teacher_membership_id ?? ''} disabled={busy} onChange={e => void assignTeacher(item, e.target.value)}><option value="">Choose a teacher</option>{teachers.map(teacher => { const profile = Array.isArray(teacher.profiles) ? teacher.profiles[0] : teacher.profiles; return <option key={teacher.id} value={teacher.id}>{profile?.full_name ?? 'Teacher'}</option>; })}</select><p className="class-teacher-current">Assigned to: <strong>{teacherName(item.teacher_membership_id)}</strong></p><div className="class-student-roster">{roster.length ? roster.map(student => <div key={student.id}><span>{student.full_name}</span><small className={student.active ? 'active' : 'inactive'}>{student.active ? 'Active' : 'Inactive'}</small></div>) : <p>No students in this class yet.</p>}</div><div className="class-card-footer"><Users size={15}/><span>{roster.length} student records</span><button type="button" onClick={onOpenStudents}>Manage students & QR codes</button></div></article>; })}</div>}
  </section>;
}
