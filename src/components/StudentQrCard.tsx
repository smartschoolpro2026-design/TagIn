import { useEffect, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';

type QRCodeConstructor = {
  new(element: HTMLElement, options: { text: string; width: number; height: number; colorDark: string; colorLight: string; correctLevel: number }): unknown;
  CorrectLevel?: { M: number };
};
declare global {
  interface Window { QRCode?: QRCodeConstructor }
}
type Props = { studentName: string; className: string | null; token: string; onClose: () => void };

export function StudentQrCard({ studentName, className, token, onClose }: Props) {
  const target = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target.current) return;
    target.current.innerHTML = '';
    if (!window.QRCode) { setError('The QR code generator could not be loaded. Refresh and try again.'); return; }
    try {
      new window.QRCode(target.current, {
        text: 'TAGIN:' + token,
        width: 248,
        height: 248,
        colorDark: '#123f30',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel?.M ?? 0,
      });
    } catch {
      setError('The QR code could not be created. Please try again.');
    }
    return () => { if (target.current) target.current.innerHTML = ''; };
  }, [token]);
  return <div className="tagin-qr-overlay" role="dialog" aria-modal="true" aria-label="Student TagIn QR code">
    <section className="tagin-qr-card">
      <button className="tagin-qr-close" type="button" onClick={onClose} aria-label="Close QR code"><X size={19}/></button>
      <p className="eyebrow">STUDENT IDENTITY · TAGIN</p>
      <h2>{studentName}</h2>
      <p className="muted">{className || 'Class not set'} · Student access code</p>
      <div className="tagin-qr-image" ref={target}/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="tagin-qr-note">Keep this code with the student. Staff can scan it from their TagIn dashboard. If it is lost, issue a replacement to revoke the previous code.</p>
      <div className="tagin-qr-actions">
        <button className="primary-button" type="button" onClick={() => window.print()}><Printer size={16}/> Print QR card</button>
        <button className="secondary-button" type="button" onClick={onClose}>Done</button>
      </div>
    </section>
  </div>;
}
