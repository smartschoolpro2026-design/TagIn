import { ArrowUpRight, BusFront, CheckCircle2, GraduationCap, QrCode, ShieldCheck, Users } from 'lucide-react';
import { isSupabaseConfigured } from './lib/supabase';

const capabilities = [
  { icon: QrCode, title: 'Quick gate scans', description: 'A secure QR tag helps authorized staff record arrivals and departures.' },
  { icon: Users, title: 'Family connection', description: 'Parents and guardians can stay informed about their linked children.' },
  { icon: BusFront, title: 'Transport visibility', description: 'A foundation for recording bus pickup, arrival, and drop-off events.' },
];

export default function App() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TagIn home"><span className="brand-mark"><QrCode size={21} /></span><span>TagIn</span></a>
        <span className="topbar-note"><ShieldCheck size={15} /> School safety platform</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> MULTI-SCHOOL PLATFORM</div>
          <h1>Every arrival.<br /><span>Every departure.</span><br />In the know.</h1>
          <p className="hero-description">A clearer, safer way for schools to manage student movement and keep families informed.</p>
          <div className="setup-status" role="status">
            {isSupabaseConfigured ? <CheckCircle2 size={17} /> : <ShieldCheck size={17} />}
            <span>{isSupabaseConfigured ? 'Supabase environment configured' : 'Application foundation ready · Supabase connection pending'}</span>
          </div>
        </div>
        <div className="hero-art" aria-label="Illustration of a student identity tag">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="tag-card">
            <div className="tag-card-top"><span>TAGIN PASS</span><QrCode size={18} /></div>
            <div className="tag-avatar"><GraduationCap size={35} /></div>
            <div className="tag-lines"><i /><i /><i /></div>
            <div className="tag-code"><QrCode size={70} strokeWidth={1.6} /><span>SECURE STUDENT TAG</span></div>
          </div>
          <div className="floating-check"><CheckCircle2 size={19} /><span>Check-in recorded</span></div>
        </div>
      </section>

      <section className="capabilities" aria-labelledby="capabilities-title">
        <div className="section-heading"><div><p className="eyebrow">BUILT FOR SCHOOL COMMUNITIES</p><h2 id="capabilities-title">One connected school day.</h2></div><span className="section-count">01 / FOUNDATION</span></div>
        <div className="capability-grid">
          {capabilities.map(({ icon: Icon, title, description }, index) => (
            <article className="capability-card" key={title}><div className="capability-icon"><Icon size={21} /></div><span className="card-index">0{index + 1}</span><h3>{title}</h3><p>{description}</p><ArrowUpRight className="card-arrow" size={18} /></article>
          ))}
        </div>
      </section>

      <footer className="footer"><span>© {new Date().getFullYear()} TagIn</span><span>Designed for safer school journeys</span></footer>
    </main>
  );
}
