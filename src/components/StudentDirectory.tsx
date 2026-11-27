import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, Plus, QrCode, Search, UserRound, Users, X } from 'lucide-react';
import { StudentQrCard } from './StudentQrCard';
import { BulkStudentQrCards, type BulkQrStudent } from './BulkStudentQrCards';

type Student = {
  id: string;
  full_name: string;
  class_id: string | null;
  class_name: string | null;
  level: string | null;
  active: boolean;
  created_at: string;
};

type SchoolClass = { id: string; class_name: string; level: string };

type Props = {
  client: SupabaseClient;
  schoolId: string;
  schoolName: string;
  onBack: () => void;
};

export function StudentDirectory({ client, schoolId, schoolName, onBack }: Props) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState('');
  const [qrStudent, setQrStudent] = useState<Student | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [bulkClassId, setBulkClassId] = useState('');
  const [bulkQrStudents, setBulkQrStudents] = useState<BulkQrStudent[]>([]);

  useEffect(() => {
    let alive = true;
    async function loadStudents() {
      setLoading(true);
      setError('');
      const [studentResult, classResult] = await Promise.all([
        client.from('students').select('id,full_name,class_id,class_name,level,active,created_at').eq('school_id', schoolId).order('full_name', { ascending: true }),
        client.from('school_classes').select('id,class_name,level').eq('school_id', schoolId).order('class_name')
      ]);
      if (!alive) return;
      if (studentResult.error || classResult.error) setError('We could not load this school’s student register. Please try again.');
      else { setStudents((studentResult.data ?? []) as Student[]); setClasses((classResult.data ?? []) as SchoolClass[]); }
      setLoading(false);
    }
    void loadStudents();
    return () => { alive = false; };
  }, [client, schoolId]);

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) =>
      [student.full_name, student.class_name ?? '', student.level ?? ''].some((value) => value.toLowerCase().includes(term)),
    );
  }, [students, search]);

  const activeCount = students.filter((student) => student.active).length;

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fullName.trim();
    if (name.length < 2) {
      setError('Enter the student’s full name.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: insertError } = await client
      .from('students')
      .insert({ school_id: schoolId, full_name: name, class_id: classId || null })
      .select('id,full_name,class_id,class_name,level,active,created_at')
      .single();
    if (insertError) {
      setError(insertError.message.includes('row-level security')
        ? 'Your account is not permitted to add students to this school.'
        : 'The student could not be saved. Please check the details and try again.');
    } else if (data) {
      setStudents((current) => [...current, data as Student].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setFullName('');
      setClassId('');
      setShowForm(false);
      setNotice('Student added to the school register.');
    }
    setBusy(false);
  }

  async function toggleStudent(student: Student) {
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: updateError } = await client
      .from('students')
      .update({ active: !student.active })
      .eq('id', student.id)
      .eq('school_id', schoolId)
      .select('id,full_name,class_id,class_name,level,active,created_at')
      .single();
    if (updateError) setError('We could not update this student’s status. Please try again.');
    else if (data) {
      setStudents((current) => current.map((item) => item.id === student.id ? data as Student : item));
      setNotice(data.active ? 'Student reactivated.' : 'Student marked inactive. Their records have been preserved.');
    }
    setBusy(false);
  }

  async function issueClassQrPasses() {
    if (!bulkClassId || busy) return;
    const selectedClass = classes.find(item => item.id === bulkClassId);
    if (!selectedClass) return;
    const roster = students.filter(item => item.active && item.class_id === bulkClassId);
    if (!roster.length) { setError('There are no active students in this class to generate QR passes for.'); return; }
    setBusy(true); setError(''); setNotice(''); setBulkQrStudents([]);
    try {
      const issued = await Promise.all(roster.map(async student => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        return { student, token, tokenHash };
      }));
      const studentIds = issued.map(item => item.student.id);
      const { data: previousTags, error: previousError } = await client.from('tags').select('id,student_id').eq('school_id', schoolId).in('student_id', studentIds).eq('status', 'active');
      if (previousError) throw new Error('Existing student QR passes could not be checked. No codes were changed.');
      const { data: newTags, error: insertError } = await client.from('tags')
        .insert(issued.map(item => ({ school_id: schoolId, student_id: item.student.id, token_hash: item.tokenHash, tag_type: 'bag', status: 'active' })))
        .select('id,student_id');
      if (insertError || !newTags || newTags.length !== issued.length) throw new Error('The class QR passes could not all be issued. No previous codes were revoked.');
      const previousIds = (previousTags ?? []).map(item => item.id);
      if (previousIds.length) {
        const { error: revokeError } = await client.from('tags').update({ status: 'revoked', revoked_at: new Date().toISOString() }).in('id', previousIds);
        if (revokeError) {
          await client.from('tags').update({ status: 'revoked', revoked_at: new Date().toISOString() }).in('id', newTags.map(item => item.id));
          throw new Error('Previous codes could not be safely replaced. The newly generated codes have been revoked; try again.');
        }
      }
      setBulkQrStudents(issued.map(item => ({ id: item.student.id, full_name: item.student.full_name, class_name: item.student.class_name ?? selectedClass.class_name, level: item.student.level ?? selectedClass.level, token: item.token })));
      setNotice('QR passes generated for ' + issued.length + ' active students. Previous active codes have been revoked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Class QR passes could not be generated.');
    } finally { setBusy(false); }
  }

  async function issueStudentQr(student: Student) {
    if (!student.active || busy) return;
    setBusy(true); setError(''); setNotice(''); setQrStudent(null); setQrToken('');
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const { data: tag, error: insertError } = await client.from('tags')
        .insert({ school_id: schoolId, student_id: student.id, token_hash: tokenHash, status: 'active' })
        .select('id').single();
      if (insertError || !tag) throw new Error('The student QR tag could not be issued. Check administrator access and try again.');
      const { error: revokeError } = await client.from('tags')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('school_id', schoolId).eq('student_id', student.id).eq('status', 'active').neq('id', tag.id);
      if (revokeError) {
        await client.from('tags').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', tag.id);
        throw new Error('The previous student code could not be safely replaced. No new code was issued.');
      }
      setQrStudent(student); setQrToken(token);
      setNotice('A new student QR code has been issued. Previous codes for this student are now revoked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The student QR code could not be issued.');
    } finally { setBusy(false); }
  }

  return (
    <section className="student-directory">
      <div className="student-page-heading">
        <div>
          <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to dashboard</button>
          <p className="eyebrow">SCHOOL OPERATIONS</p>
          <h1>Student directory</h1>
          <p className="muted">{schoolName} · Manage the school’s core student register.</p>
        </div>
        <button className="primary-button add-student-button" type="button" onClick={() => { setShowForm((value) => !value); setError(''); setNotice(''); }}>
          {showForm ? <X size={17} /> : <Plus size={17} />}
          {showForm ? 'Close form' : 'Add student'}
        </button>
      </div>

      <section className="student-bulk-qr-panel"><div><p className="eyebrow">CLASS QR GENERATOR</p><h2>Generate QR passes for a whole class</h2><p className="muted">Creates one unique bag-tag QR code for every active student in the selected class.</p></div><div className="student-bulk-qr-controls"><select aria-label="Select class for QR generation" value={bulkClassId} onChange={event => setBulkClassId(event.target.value)}><option value="">Select a class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.class_name}{item.level ? ' · ' + item.level : ''}</option>)}</select><button className="primary-button" type="button" disabled={busy || !bulkClassId || !students.some(item => item.active && item.class_id === bulkClassId)} onClick={() => void issueClassQrPasses()}><QrCode size={16}/>{busy ? 'Generating…' : 'Generate class QR passes'}</button></div></section>

      <div className="student-summary">
        <div><span className="student-summary-icon"><Users size={19} /></span><strong>{students.length}</strong><span>Total students</span></div>
        <div><span className="student-summary-icon"><UserRound size={19} /></span><strong>{activeCount}</strong><span>Active students</span></div>
        <div><span className="student-summary-icon"><BookOpen size={19} /></span><strong>{classes.length}</strong><span>Classes represented</span></div>
      </div>

      {showForm && (
        <form className="student-form" onSubmit={addStudent}>
          <div className="student-form-heading"><div><h2>Add a student</h2><p>Enter the student’s basic school details.</p></div></div>
          <label htmlFor="student-full-name">Student full name</label>
          <input id="student-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Enter full name" minLength={2} maxLength={160} required />
          <div className="student-form-grid"><div><label htmlFor="student-class">Assign to class</label><select id="student-class" value={classId} onChange={event => setClassId(event.target.value)}><option value="">No class assigned yet</option>{classes.map(item => <option key={item.id} value={item.id}>{item.class_name}{item.level ? ' · ' + item.level : ''}</option>)}</select></div></div>
          <div className="student-form-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving student…' : 'Save student'}</button></div>
        </form>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="student-notice" role="status">{notice}</p>}

      <div className="student-list-panel">
        <div className="student-list-heading"><div><h2>Registered students</h2><p>Only records belonging to this school are shown.</p></div><span>{filteredStudents.length} shown</span></div>
        <label className="student-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by student or class" /></label>
        {loading ? <div className="student-empty">Loading student register…</div> : filteredStudents.length === 0 ? (
          <div className="student-empty">{students.length === 0 ? 'No students have been registered yet. Add the first student to begin.' : 'No students match your search.'}</div>
        ) : (
          <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student</th><th>Class</th><th>Level</th><th>Status</th><th>QR code</th><th>Action</th></tr></thead><tbody>
            {filteredStudents.map((student) => <tr key={student.id}><td><strong>{student.full_name}</strong><span className="student-id">Student record</span></td><td>{student.class_name || '—'}</td><td>{student.level || '—'}</td><td><span className={student.active ? 'student-status active' : 'student-status inactive'}>{student.active ? 'Active' : 'Inactive'}</span></td><td><button className="student-row-action student-qr-action" type="button" disabled={busy||!student.active} onClick={() => void issueStudentQr(student)}><QrCode size={14}/> {student.active?'Issue QR':'Unavailable'}</button></td><td><button className="student-row-action" type="button" disabled={busy} onClick={() => void toggleStudent(student)}>{student.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}
          </tbody></table></div>
        )}
      </div>
      <p className="student-footnote">Student records are retained when marked inactive. Attendance history is not deleted.</p>
      {bulkQrStudents.length>0&&<BulkStudentQrCards schoolName={schoolName} classLabel={classes.find(item=>item.id===bulkClassId)?.class_name ?? 'Class'} students={bulkQrStudents} onClose={()=>setBulkQrStudents([])}/>}
      {qrStudent&&qrToken&&<StudentQrCard studentName={qrStudent.full_name} className={qrStudent.class_name} token={qrToken} onClose={()=>{setQrStudent(null);setQrToken('');}}/>}
    </section>
  );
}
