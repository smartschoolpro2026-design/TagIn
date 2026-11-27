import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

function ConnectionNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  if (online) return null;
  return <div role="status" style={{position:'fixed',zIndex:2000,top:0,left:0,right:0,padding:'9px 14px',background:'#fff1dc',color:'#75440d',textAlign:'center',fontSize:13,fontWeight:700,boxShadow:'0 2px 10px rgba(0,0,0,.08)'}}>You are offline. Only information already saved on this device is available.</div>;
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('TagIn offline app-shell setup failed:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectionNotice />
    <App />
  </React.StrictMode>,
);
