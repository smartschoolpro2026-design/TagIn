import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, Plus, Search, UserRound, Users, X } from 'lucide-react';

type Student = {
  id: string;
  full_name: string;
  class_name: string | null;
  level: string | null;
  active: boolean;
  created_at: string;
};

type Props = {
  client: SupabaseClient;
  schoolId: string;
  schoolName: string;
  onBack: () => void;
};

export function StudentDirectory({ client, schoolId, schoolName, onBack }: Props) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [className, setClassName] = useState('');
  const [level, setLevel] = useState('');

  useEffect(() => {
    let alive = true;
    async function loadStudents() {
      setLoading(true);
      setError('');
      const { data, error: queryError } = await client
        .from('students')
        .select('id,full_name,class_name,level,active,created_at')
        .eq('school_id', schoolId)
        .order('full_name', { ascending: true });
      if (!alive) return;
      if (queryError) setError('We could not load this school’s student register. Please try again.');
      else setStudents((data ?? []) as Student[]);
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
      .insert({
        school_id: schoolId,
        full_name: name,
        class_name: className.trim() || null,
        level: level.trim() || null,
      })
      .select('id,full_name,class_name,level,active,created_at')
      .single();
    if (insertError) {
      setError(insertError.message.includes('row-level security')
        ? 'Your account is not permitted to add students to this school.'
        : 'The student could not be saved. Please check the details and try again.');
    } else if (data) {
      setStudents((current) => [...current, data as Student].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setFullName('');
      setClassName('');
      setLevel('');
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
      .select('id,full_name,class_name,level,active,created_at')
      .single();
    if (updateError) setError('We could not update this student’s status. Please try again.');
    else if (data) {
      setStudents((current) => current.map((item) => item.id === student.id ? data as Student : item));
      setNotice(data.active ? 'Student reactivated.' : 'Student marked inactive. Their records have been preserved.');
    }
    setBusy(false);
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

      <div className="student-summary">
        <div><span className="student-summary-icon"><Users size={19} /></span><strong>{students.length}</strong><span>Total students</span></div>
        <div><span className="student-summary-icon"><UserRound size={19} /></span><strong>{activeCount}</strong><span>Active students</span></div>
        <div><span className="student-summary-icon"><BookOpen size={19} /></span><strong>{new Set(students.map((student) => student.class_name).filter(Boolean)).size}</strong><span>Classes represented</span></div>
      </div>

      {showForm && (
        <form className="student-form" onSubmit={addStudent}>
          <div className="student-form-heading"><div><h2>Add a student</h2><p>Enter the student’s basic school details.</p></div></div>
          <label htmlFor="student-full-name">Student full name</label>
          <input id="student-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Enter full name" minLength={2} maxLength={160} required />
          <div className="student-form-grid">
            <div><label htmlFor="student-class">Class</label><input id="student-class" value={className} onChange={(event) => setClassName(event.target.value)} placeholder="e.g. Primary 4" maxLength={80} /></div>
            <div><label htmlFor="student-level">Level / section</label><input id="student-level" value={level} onChange={(event) => setLevel(event.target.value)} placeholder="e.g. Blue" maxLength={80} /></div>
          </div>
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
          <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student</th><th>Class</th><th>Level</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {filteredStudents.map((student) => <tr key={student.id}><td><strong>{student.full_name}</strong><span className="student-id">Student record</span></td><td>{student.class_name || '—'}</td><td>{student.level || '—'}</td><td><span className={student.active ? 'student-status active' : 'student-status inactive'}>{student.active ? 'Active' : 'Inactive'}</span></td><td><button className="student-row-action" type="button" disabled={busy} onClick={() => void toggleStudent(student)}>{student.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}
          </tbody></table></div>
        )}
      </div>
      <p className="student-footnote">Student records are retained when marked inactive. Attendance history is not deleted.</p>
    </section>
  );
}
