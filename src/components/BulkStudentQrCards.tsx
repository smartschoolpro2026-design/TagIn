import { useEffect, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';

type QRCodeConstructor = {
  new(element: HTMLElement, options: { text: string; width: number; height: number; colorDark: string; colorLight: string; correctLevel: number }): unknown;
  CorrectLevel?: { M: number };
};
declare global { interface Window { QRCode?: QRCodeConstructor } }
export type BulkQrStudent = { id: string; full_name: string; class_name: string | null; level: string | null; token: string };
type Props = { schoolName: string; classLabel: string; students: BulkQrStudent[]; onClose: () => void };

export function BulkStudentQrCards({ schoolName, classLabel, students, onClose }: Props) {
  const root = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!root.current) return;
    root.current.querySelectorAll('[data-qr-token]').forEach((node) => {
      const element = node as HTMLElement;
      element.innerHTML = '';
      const token = element.dataset.qrToken;
      if (!token || !window.QRCode) { setError('The QR generator is unavailable. Refresh and try again.'); return; }
      try { new window.QRCode(element, { text: 'TAGIN:' + token, width: 172, height: 172, colorDark: '#123f30', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel?.M ?? 0 }); }
      catch { setError('One or more QR codes could not be rendered. Please refresh and try again.'); }
    });
  }, [students]);
  return <div className="tagin-qr-overlay tagin-bulk-qr-overlay" role="dialog" aria-modal="true" aria-label="Class student QR cards">
    <section className="tagin-bulk-qr-panel">
      <header className="tagin-bulk-qr-heading">
        <div><p className="eyebrow">TAGIN · STUDENT IDENTITY</p><h2>{classLabel} QR passes</h2><p>{schoolName} · {students.length} active student cards</p></div>
        <button className="tagin-qr-close" type="button" onClick={onClose} aria-label="Close QR cards"><X size={19}/></button>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="tagin-bulk-qr-grid" ref={root}>{students.map(student => <article className="tagin-bulk-qr-card" key={student.id}>
        <p className="tagin-bulk-brand">TagIn</p><h3>{student.full_name}</h3><p className="tagin-bulk-class">{student.class_name || classLabel}{student.level ? ' · ' + student.level : ''}</p>
        <div className="tagin-bulk-qr-image" data-qr-token={student.token}/>
        <p className="tagin-bulk-school">{schoolName}</p><small>Student bag tag · Keep this code secure</small>
      </article>)}</div>
      <footer className="tagin-qr-actions tagin-bulk-qr-actions"><button className="primary-button" type="button" onClick={() => window.print()}><Printer size={16}/> Print all cards</button><button className="secondary-button" type="button" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}
