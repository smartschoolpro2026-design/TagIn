import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, Plus, Users, RefreshCw } from 'lucide-react';

type SchoolClass = { id: string; class_name: string; level: string };
type Student = { id: string; full_name: string; class_id: string; class_name: string | null; level: string | null; active: boolean; created_at: string };
type AttendanceEvent = { id: string; student_id: string; event_type: 'check_in' | 'check_out'; created_at: string };
type Props = { client: SupabaseClient; schoolId: string; schoolName: string; membershipId: string; onBack: () => void };

export function TeacherWorkspace({ client, schoolId, schoolName, membershipId, onBack }: Props) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceEvent>>({});
  const [selectedClassId, setSelectedClassId] = useState('');
  const [fullName, setFullName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const { data: classRows, error: classError } = await client
      .from('school_classes')
      .select('id,class_name,level')
      .eq('school_id', schoolId)
      .eq('teacher_membership_id', membershipId)
      .order('class_name');
    if (classError) {
      setError('Your assigned classes could not be loaded. Please refresh or contact the school administrator.');
      setClasses([]);
      setStudents([]);
      setLoading(false);
      return;
    }
    const nextClasses = (classRows ?? []) as SchoolClass[];
    setClasses(nextClasses);
    const validSelected = nextClasses.some(item => item.id === selectedClassId);
    const nextSelected = validSelected ? selectedClassId : nextClasses[0]?.id ?? '';
    setSelectedClassId(nextSelected);
    if (nextClasses.length) {
      const { data, error: studentError } = await client
        .from('students')
        .select('id,full_name,class_id,class_name,level,active,created_at')
        .eq('school_id', schoolId)
        .in('class_id', nextClasses.map(item => item.id))
        .order('full_name');
      if (studentError) setError('Your class register could not be loaded.');
      else setStudents((data ?? []) as Student[]);
    } else setStudents([]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [client, schoolId, membershipId]);
  useEffect(() => {
    const channel = client.channel('teacher-class-register-' + membershipId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_classes', filter: 'school_id=eq.' + schoolId }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: 'school_id=eq.' + schoolId }, () => { void load(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, schoolId, membershipId]);

  const selectedClass = classes.find(item => item.id === selectedClassId) ?? null;
  const visibleStudents = useMemo(() => students.filter(item => item.class_id === selectedClassId), [students, selectedClassId]);
  const todayPresentCount = visibleStudents.filter(student => attendance[student.id]?.event_type === 'check_in').length;
  async function loadAttendance() {
    const studentIds = students.map(student => student.id);
    if (!studentIds.length) { setAttendance({}); return; }
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { data, error: attendanceError } = await client.from('scan_events')
      .select('id,student_id,event_type,created_at')
      .eq('school_id', schoolId)
      .in('student_id', studentIds)
      .in('event_type', ['check_in', 'check_out'])
      .gte('created_at', dayStart.toISOString())
      .order('created_at', { ascending: false });
    if (attendanceError) { setError('Today’s attendance could not be loaded. Ask the administrator to verify teacher attendance access.'); return; }
    const latest: Record<string, AttendanceEvent> = {};
    for (const event of (data ?? []) as AttendanceEvent[]) if (!latest[event.student_id]) latest[event.student_id] = event;
    setAttendance(latest);
  }

  useEffect(() => {
    if (!students.length) { setAttendance({}); return; }
    void loadAttendance();
  }, [client, schoolId, students]);

  useEffect(() => {
    const channel = client.channel('teacher-attendance-' + membershipId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_events', filter: 'school_id=eq.' + schoolId }, () => { void loadAttendance(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, schoolId, membershipId, students]);

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fullName.trim();
    if (!name || !selectedClassId || busy) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error: insertError } = await client.from('students')
      .insert({ school_id: schoolId, class_id: selectedClassId, full_name: name })
      .select('id,full_name,class_id,class_name,level,active,created_at')
      .single();
    if (insertError) {
      setError(insertError.message.includes('row-level security')
        ? 'You can add students only to a class assigned to your teacher account.'
        : 'The student could not be saved. Please try again.');
    } else if (data) {
      setStudents(current => [...current, data as Student].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setFullName(''); setShowForm(false);
      setNotice('Student added. The school administrator can now see this student in the same class register.');
    }
    setBusy(false);
  }

  return <section className="teacher-workspace">
    <div className="teacher-workspace-heading">
      <div>
        <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button>
        <p className="eyebrow">TEACHING WORKSPACE · {schoolName}</p>
        <h1>My classes</h1>
        <p className="muted">Your assigned class registers and today’s gate attendance update automatically as students arrive and leave.</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="student-notice" role="status">{notice}</p>}
    {loading ? <p className="empty-state">Loading your class registers…</p> : classes.length === 0 ? (
      <div className="teacher-empty"><BookOpen size={30}/><h2>No class assigned yet</h2><p>Ask your School Admin to create a class and assign it to your teacher account. Once assigned, it will appear here automatically.</p></div>
    ) : <>
      <div className="teacher-class-summary"><article><span>Assigned classes</span><strong>{classes.length}</strong></article><article><span>Students in your classes</span><strong>{students.filter(item => item.active).length}</strong></article></div>
      <div className="teacher-class-tabs">{classes.map(item => <button type="button" key={item.id} className={selectedClassId === item.id ? 'active' : ''} onClick={() => setSelectedClassId(item.id)}>{item.class_name}{item.level ? ' · ' + item.level : ''}<span>{students.filter(s => s.class_id === item.id).length}</span></button>)}</div>
      {selectedClass && <section className="teacher-register-panel">
        <div className="teacher-register-heading"><div><p className="eyebrow">CLASS REGISTER</p><h2>{selectedClass.class_name}{selectedClass.level ? ' · ' + selectedClass.level : ''}</h2><p className="muted">{visibleStudents.length} students · {todayPresentCount} currently present today · Attendance syncs live from the gate</p></div><button className="primary-button" type="button" onClick={() => { setShowForm(v => !v); setError(''); setNotice(''); }}><Plus size={16}/>{showForm ? 'Close' : 'Add student'}</button></div>
        {showForm && <form className="teacher-add-student-form" onSubmit={addStudent}><label htmlFor="teacher-student-name">Student full name</label><input id="teacher-student-name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter the new student's full name" required minLength={2} maxLength={160}/><p className="muted">Class: {selectedClass.class_name}{selectedClass.level ? ' · ' + selectedClass.level : ''}</p><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving student…' : 'Save student to class'}</button></form>}
        {visibleStudents.length ? <div className="teacher-student-list">{visibleStudents.map(student => <article key={student.id}><span className="teacher-student-avatar">{student.full_name.slice(0,1).toUpperCase()}</span><div><strong>{student.full_name}</strong><small>{student.class_name ?? selectedClass.class_name}{student.level ? ' · ' + student.level : ''}</small><small className="teacher-attendance-time">{attendance[student.id] ? (attendance[student.id].event_type === 'check_in' ? 'Arrival: ' : 'Departure: ') + new Date(attendance[student.id].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No check-in recorded today'}</small></div><span className={'student-status '+(attendance[student.id]?.event_type === 'check_in' ? 'active' : attendance[student.id]?.event_type === 'check_out' ? 'inactive' : 'pending')}>{attendance[student.id]?.event_type === 'check_in' ? 'Present' : attendance[student.id]?.event_type === 'check_out' ? 'Checked out' : 'Not arrived'}</span></article>)}</div> : <div className="teacher-empty"><Users size={25}/><p>No students have been added to this class yet.</p></div>}
      </section>}
    </>}
  </section>;
}
