import { useState } from 'react';
import { unlockSiteGate } from '../lib/site-gate';
import BrandLogo from './BrandLogo';
import './SiteGate.css';

export default function SiteGate({ children }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem('slt-site-gate-unlocked') === (import.meta.env.VITE_SITE_GATE_KEY || 'Dientito2032');
    } catch {
      return false;
    }
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (unlockSiteGate(password)) {
      setUnlocked(true);
      setError('');
      return;
    }
    setError('Clave incorrecta.');
  };

  if (unlocked) return children;

  return (
    <section className="site-gate">
      <div className="site-gate-aurora site-gate-aurora--one" aria-hidden="true" />
      <div className="site-gate-aurora site-gate-aurora--two" aria-hidden="true" />
      <div className="site-gate-aurora site-gate-aurora--three" aria-hidden="true" />

      <div className="site-gate-panel page-rise">
        <BrandLogo className="site-gate-logo" variant="hero" />
        <p className="site-gate-kicker">Acceso privado</p>
        <h1>Creative production studio</h1>
        <p>Ingresá la clave para entrar al entorno de trabajo de Sweet Little Trauma Studio.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Clave de acceso"
            autoComplete="current-password"
            autoFocus
          />
          <button type="submit">Entrar al Studio</button>
        </form>
        {error ? <p className="site-gate-error">{error}</p> : null}
      </div>
    </section>
  );
}
