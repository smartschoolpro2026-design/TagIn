import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, BookOpen, Plus, QrCode, Search, UserRound, Users, X, Pencil } from 'lucide-react';
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
type SchoolClass = { id: string; class_name: string; level: string; teacher_membership_id: string | null };
type Teacher = { id: string; user_id: string; profiles: { full_name: string } | { full_name: string }[] | null };
type Props = { client: SupabaseClient; schoolId: string; schoolName: string; userId: string; onBack: () => void; canManageClasses?: boolean };

export function StudentDirectory({ client, schoolId, schoolName, userId, onBack, canManageClasses = true }: Props) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState('');
  const [teacherMembershipId, setTeacherMembershipId] = useState('');
  const [showNewClass, setShowNewClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassLevel, setNewClassLevel] = useState('');
  const [qrStudent, setQrStudent] = useState<Student | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [qrReference, setQrReference] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [bulkQrStudents, setBulkQrStudents] = useState<BulkQrStudent[]>([]);

  async function loadRegister() {
    setLoading(true);
    setError('');
    const [studentResult, classResult, teacherResult] = await Promise.all([
      client.from('students').select('id,full_name,class_id,class_name,level,active,created_at').eq('school_id', schoolId).order('full_name', { ascending: true }),
      client.from('school_classes').select('id,class_name,level,teacher_membership_id').eq('school_id', schoolId).order('class_name'),
      client.from('school_memberships').select('id,user_id,profiles(full_name)').eq('school_id', schoolId).eq('role', 'staff').eq('status', 'active').order('created_at')
    ]);
    if (studentResult.error || classResult.error || teacherResult.error) {
      setError('We could not load the student register, classes or teachers. Please try again.');
    } else {
      setStudents((studentResult.data ?? []) as Student[]);
      setClasses((classResult.data ?? []) as SchoolClass[]);
      setTeachers((teacherResult.data ?? []) as unknown as Teacher[]);
    }
    setLoading(false);
  }
  useEffect(() => { void loadRegister(); }, [client, schoolId]);

  const selectedClass = classes.find(item => item.id === selectedClassId) ?? null;
  const classStudents = useMemo(() => {
    if (!selectedClassId) return [];
    return students.filter(student => student.class_id === selectedClassId || (!student.class_id && student.class_name === selectedClass?.class_name && (student.level ?? '') === (selectedClass?.level ?? '')));
  }, [students, selectedClassId, selectedClass]);
  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return classStudents;
    return classStudents.filter(student => {
      const assignedClass = classes.find(item => item.id === student.class_id);
      const assignedTeacher = teacherName(assignedClass?.teacher_membership_id ?? null).toLowerCase();
      return [student.full_name, student.class_name ?? '', student.level ?? '', assignedTeacher].some(value => value.toLowerCase().includes(term));
    });
  }, [classStudents, classes, search, teachers]);

  const activeCount = classStudents.filter(student => student.active).length;
  const inactiveCount = classStudents.length - activeCount;
  function teacherName(membershipId: string | null) {
    const teacher = teachers.find(item => item.id === membershipId);
    const profile = Array.isArray(teacher?.profiles) ? teacher?.profiles[0] : teacher?.profiles;
    return profile?.full_name ?? 'Not assigned';
  }
  function resetForm() {
    setShowForm(false); setEditing(null); setFullName(''); setClassId(''); setTeacherMembershipId('');
    setShowNewClass(false); setNewClassName(''); setNewClassLevel('');
  }
  function openNewStudent() {
    resetForm(); setShowForm(true); setError(''); setNotice('');
  }
  function openEditStudent(student: Student) {
    const assignedClass = classes.find(item => item.id === student.class_id);
    setSelectedClassId(student.class_id ?? '');
    setEditing(student); setFullName(student.full_name); setClassId(student.class_id ?? '');
    setTeacherMembershipId(assignedClass?.teacher_membership_id ?? '');
    setShowNewClass(false); setShowForm(true); setError(''); setNotice('');
  }
  function changeClass(nextId: string) {
    setClassId(nextId);
    const selected = classes.find(item => item.id === nextId);
    setTeacherMembershipId(selected?.teacher_membership_id ?? '');
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const name = fullName.trim();
    if (name.length < 2) { setError('Enter the student’s full name.'); return; }
    if (!teacherMembershipId) { setError('Select the teacher responsible for this student.'); return; }
    if (showNewClass && !newClassName.trim()) { setError('Enter the new class name.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      let selectedClassId = classId;
      let selectedClass = classes.find(item => item.id === classId);
      if (showNewClass) {
        const { data: createdClass, error: classError } = await client.from('school_classes')
          .insert({ school_id: schoolId, class_name: newClassName.trim(), level: newClassLevel.trim(), teacher_membership_id: teacherMembershipId, created_by: userId })
          .select('id,class_name,level,teacher_membership_id').single();
        if (classError || !createdClass) throw new Error(classError?.code === '23505' ? 'That class already exists. Select it from the class list.' : 'The new class could not be created. Please try again.');
        selectedClass = createdClass as SchoolClass;
        selectedClassId = selectedClass.id;
        setClasses(current => [...current, selectedClass!].sort((a,b) => a.class_name.localeCompare(b.class_name)));
      } else {
        if (!selectedClass) throw new Error('Select a class for this student.');
        if (selectedClass.teacher_membership_id !== teacherMembershipId) {
          const { data: updatedClass, error: teacherError } = await client.from('school_classes')
            .update({ teacher_membership_id: teacherMembershipId, updated_at: new Date().toISOString() })
            .eq('id', selectedClass.id).eq('school_id', schoolId)
            .select('id,class_name,level,teacher_membership_id').single();
          if (teacherError || !updatedClass) throw new Error('The class teacher could not be assigned. Please try again.');
          selectedClass = updatedClass as SchoolClass;
          setClasses(current => current.map(item => item.id === selectedClass!.id ? selectedClass! : item));
        }
      }
      const studentValues = {
        full_name: name,
        class_id: selectedClassId,
        class_name: selectedClass?.class_name ?? null,
        level: selectedClass?.level ?? null
      };
      if (editing) {
        const { data, error: updateError } = await client.from('students').update(studentValues)
          .eq('id', editing.id).eq('school_id', schoolId)
          .select('id,full_name,class_id,class_name,level,active,created_at').single();
        if (updateError || !data) throw new Error('The student could not be updated. Please check the details and try again.');
        setStudents(current => current.map(item => item.id === editing.id ? data as Student : item));
        setNotice('Student details, class and teacher assignment saved.');
      } else {
        const { data, error: insertError } = await client.from('students').insert({ school_id: schoolId, ...studentValues })
          .select('id,full_name,class_id,class_name,level,active,created_at').single();
        if (insertError || !data) throw new Error(insertError?.code === '42501' ? 'Your account is not permitted to add students to this school.' : 'The student could not be saved. Please check the details and try again.');
        setStudents(current => [...current, data as Student].sort((a,b) => a.full_name.localeCompare(b.full_name)));
        setNotice('Student added with the selected class and teacher.');
      }
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The student could not be saved.');
    } finally { setBusy(false); }
  }

  async function toggleStudent(student: Student) {
    setBusy(true); setError(''); setNotice('');
    const { data, error: updateError } = await client.from('students').update({ active: !student.active })
      .eq('id', student.id).eq('school_id', schoolId)
      .select('id,full_name,class_id,class_name,level,active,created_at').single();
    if (updateError) setError('We could not update this student’s status. Please try again.');
    else if (data) {
      setStudents(current => current.map(item => item.id === student.id ? data as Student : item));
      setNotice(data.active ? 'Student reactivated.' : 'Student marked inactive. Their records have been preserved.');
    }
    setBusy(false);
  }

  async function issueClassQrPasses() {
    if (!selectedClassId || busy || !selectedClass) return;
    const roster = classStudents.filter(item => item.active);
    if (!roster.length) { setError('There are no active students in this class to generate QR passes for.'); return; }
    setBusy(true); setError(''); setNotice(''); setBulkQrStudents([]);
    try {
      const issued = await Promise.all(roster.map(async student => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const candidateToken = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidateToken));
        const candidateHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        const { data, error } = await client.rpc('get_or_create_student_qr', {
          p_student_id: student.id, p_token: candidateToken, p_token_hash: candidateHash
        });
        if (error || typeof data?.token !== 'string') throw new Error('A secure QR pass could not be prepared for ' + student.full_name + '.');
        if (typeof data?.reference_code !== 'string') throw new Error('An anonymous student reference could not be prepared.');
        return { student, token: data.token as string, referenceCode: data.reference_code as string };
      }));
      setBulkQrStudents(issued.map(item => ({ id: item.student.id, full_name: item.student.full_name, class_name: item.student.class_name ?? selectedClass.class_name, level: item.student.level ?? selectedClass.level, token: item.token, reference_code: item.referenceCode })));
      setNotice('The class QR cards are ready. Existing student references were kept unchanged.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Class QR passes could not be generated.');
    } finally { setBusy(false); }
  }

  async function issueStudentQr(student: Student) {
    if (!student.active || busy) return;
    if (!window.confirm('Replace this student’s QR reference? The old QR will stop working, and the new QR will be shared with the parent dashboard.')) return;
    setBusy(true); setError(''); setNotice(''); setQrStudent(null); setQrToken(''); setQrReference('');
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      const { data, error: replaceError } = await client.rpc('replace_student_qr', {
        p_student_id: student.id, p_token: token, p_token_hash: tokenHash
      });
      if (replaceError || typeof data?.token !== 'string') throw new Error(replaceError?.message || 'The student QR tag could not be replaced. Check administrator access and try again.');
      if (typeof data.reference_code !== 'string') throw new Error('The anonymous student reference could not be prepared.');
      setQrStudent(student); setQrToken(data.token); setQrReference(data.reference_code);
      setNotice('The student QR reference has been replaced. All older codes are now revoked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The student QR code could not be issued.');
    } finally { setBusy(false); }
  }

  return <section className="student-directory">
    <div className="student-page-heading">
      <div><button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16}/> Back to dashboard</button><p className="eyebrow">SCHOOL OPERATIONS</p><h1>Students</h1><p className="muted">{schoolName} · One place to register students and assign their class and teacher.</p></div>
      <button className="primary-button add-student-button" type="button" onClick={openNewStudent}><Plus size={17}/> Add student</button>
    </div>

    <section className="student-bulk-qr-panel student-class-overview">
      <div><p className="eyebrow">CLASS REGISTER</p><h2>{selectedClass ? selectedClass.class_name + (selectedClass.level ? " · " + selectedClass.level : "") : "Choose a class"}</h2><p className="muted">{selectedClass ? "Showing only students assigned to this class." : "Select a class to view its students, teacher and QR card options."}</p></div>
      <div className="student-bulk-qr-controls">
        <label className="student-class-select-label" htmlFor="student-register-class">Select class</label>
        <select id="student-register-class" aria-label="Select class to view student register" value={selectedClassId} onChange={event => {setSelectedClassId(event.target.value);setSearch("");setError("");setNotice("");setBulkQrStudents([]);}}><option value="">Choose a class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.class_name}{item.level ? " · " + item.level : ""}</option>)}</select>
        <button className="primary-button" type="button" disabled={busy || !selectedClassId || activeCount === 0} onClick={() => void issueClassQrPasses()}><QrCode size={16}/>{busy ? "Generating…" : "Generate class QR cards"}</button>
      </div>
    </section>

    {selectedClass ? <div className="student-summary student-class-summary">
      <div><span className="student-summary-icon"><Users size={19}/></span><strong>{classStudents.length}</strong><span>Students in {selectedClass.class_name}</span></div>
      <div><span className="student-summary-icon"><UserRound size={19}/></span><strong>{activeCount}</strong><span>Active students</span></div>
      <div><span className="student-summary-icon"><BookOpen size={19}/></span><strong>{inactiveCount}</strong><span>Inactive students</span></div>
    </div> : <div className="student-empty student-class-prompt">Select a class above. The student totals, teacher and student list will update to that class only.</div>}

    {showForm && <form className="student-form" onSubmit={saveStudent}>
      <div className="student-form-heading"><div><p className="eyebrow">{editing ? 'UPDATE STUDENT' : 'NEW STUDENT'}</p><h2>{editing ? 'Edit student details' : 'Add a student'}</h2><p>Complete the student details and assignments here. You do not need to visit another page.</p></div><button className="student-row-action" type="button" onClick={resetForm} aria-label="Close student form"><X size={17}/></button></div>
      <div className="student-form-grid"><div className="student-form-field-wide"><label htmlFor="student-full-name">Student full name</label><input id="student-full-name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Enter full name" minLength={2} maxLength={160} required/></div>
      {!showNewClass ? <div><label htmlFor="student-class">Assign class</label><select id="student-class" value={classId} onChange={event => changeClass(event.target.value)} required><option value="">Choose a class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.class_name}{item.level ? ' · ' + item.level : ''}</option>)}</select>{canManageClasses && <button className="student-inline-link" type="button" onClick={() => {setShowNewClass(true);setClassId('');setTeacherMembershipId('');}}>+ Add a new class</button>}</div> : <div><label htmlFor="new-student-class">New class name</label><input id="new-student-class" value={newClassName} onChange={event => setNewClassName(event.target.value)} placeholder="e.g. Primary 4" maxLength={80} required/><label htmlFor="new-student-level">Level / section (optional)</label><input id="new-student-level" value={newClassLevel} onChange={event => setNewClassLevel(event.target.value)} placeholder="e.g. Blue" maxLength={80}/><button className="student-inline-link" type="button" onClick={() => {setShowNewClass(false);setNewClassName('');setNewClassLevel('');}}>Choose an existing class instead</button></div>}
      <div><label htmlFor="student-teacher">Assign teacher</label><select id="student-teacher" value={teacherMembershipId} onChange={event => setTeacherMembershipId(event.target.value)} required><option value="">Choose a teacher</option>{teachers.map(teacher => {const profile = Array.isArray(teacher.profiles) ? teacher.profiles[0] : teacher.profiles;return <option key={teacher.id} value={teacher.id}>{profile?.full_name ?? 'Teacher'}</option>;})}</select>{teachers.length === 0 && <p className="student-field-hint">Add a teacher in Staff management before assigning this student.</p>}</div></div>
      {classId && !showNewClass && <p className="student-field-hint">The selected teacher becomes the class teacher for this class, and the class assignment is reflected across its student register.</p>}
      <div className="student-form-actions"><button className="secondary-button" type="button" onClick={resetForm}>Cancel</button><button className="primary-button" type="submit" disabled={busy || teachers.length === 0}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save student'}</button></div>
    </form>}

    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="student-notice" role="status">{notice}</p>}
    {selectedClass && <div className="student-list-panel"><div className="student-list-heading"><div><h2>{selectedClass.class_name} student register</h2><p>Class teacher: {teacherName(selectedClass.teacher_membership_id)}</p></div><span>{filteredStudents.length} shown</span></div>
      <label className="student-search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search student, class or teacher"/></label>
      {loading ? <div className="student-empty">Loading student register…</div> : filteredStudents.length === 0 ? <div className="student-empty">{classStudents.length === 0 ? 'No students have been assigned to this class yet. Add a student and select this class.' : 'No students match your search.'}</div> : <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student</th><th>Class</th><th>Class teacher</th><th>Status</th><th>QR code</th><th>Action</th></tr></thead><tbody>
        {filteredStudents.map(student => {const assignedClass = classes.find(item => item.id === student.class_id);return <tr key={student.id}><td><strong>{student.full_name}</strong><span className="student-id">Student record</span></td><td>{student.class_name || assignedClass?.class_name || '—'}{student.level || assignedClass?.level ? <span className="student-id">{student.level || assignedClass?.level}</span> : null}</td><td>{teacherName(assignedClass?.teacher_membership_id ?? null)}</td><td><span className={student.active ? 'student-status active' : 'student-status inactive'}>{student.active ? 'Active' : 'Inactive'}</span></td><td><button className="student-row-action student-qr-action" type="button" disabled={busy || !student.active} onClick={() => void issueStudentQr(student)}><QrCode size={14}/> {student.active ? 'Replace QR' : 'Unavailable'}</button></td><td><div className="student-row-actions"><button className="student-row-action" type="button" disabled={busy} onClick={() => openEditStudent(student)}><Pencil size={14}/> Edit</button><button className="student-row-action" type="button" disabled={busy} onClick={() => void toggleStudent(student)}>{student.active ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>;})}
      </tbody></table></div>}
    </div>}
    <p className="student-footnote">Student records are retained when marked inactive. Attendance history is not deleted. Class and teacher assignments can be updated from this page.</p>
    {bulkQrStudents.length > 0 && <BulkStudentQrCards schoolName={schoolName} classLabel={selectedClass?.class_name ?? 'Class'} students={bulkQrStudents} onClose={() => setBulkQrStudents([])}/>}
    {qrStudent && qrToken && <StudentQrCard referenceCode={qrReference} token={qrToken} onClose={() => {setQrStudent(null);setQrToken('');}}/>}
  </section>;
}
