import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import './StudioLayout.css';

const TOOLS = [
  { label: 'App Library', desc: 'Explore our applications', path: '/engineering' },
  { label: 'Game Library', desc: 'Discover and play games', path: '/engineering' },
  { label: 'Custom App Request', desc: 'Request a custom app', path: '/contact' },
  { label: 'Business Automation', desc: 'Streamline processes', path: '/assist' },
  { label: 'Creative Tools', desc: 'Design, edit, create', path: '/image' },
  { label: 'Prototype Lab', desc: 'Test ideas & prototype', path: '/video' },
];

const ACTIONS = [
  { label: 'Client Dashboard', desc: 'Project progress', path: '/ceo' },
  { label: 'Premium Access', desc: 'Unlock premium', path: '/subscription' },
  { label: 'Support', desc: 'Get help', path: '/help' },
  { label: 'Pricing', desc: 'Plans & pricing', path: '/subscription' },
  { label: 'Submit Idea', desc: 'Share your idea', path: '/contact' },
];

const ROADMAP = [
  { phase: 'Intake', status: 'Active' },
  { phase: 'Scoping', status: 'Active' },
  { phase: 'Build queue', status: 'Queued' },
  { phase: 'Delivery', status: 'Planned' },
];

export default function EngineeringLab() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [activeTool, setActiveTool] = useState('Custom App Request');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [brief, setBrief] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const handleExecute = async () => {
    if (!brief.trim() || brief.trim().length < 12) {
      setStatus('Escribí un brief más detallado (mínimo 12 caracteres).');
      return;
    }
    if (!isAuthenticated) {
      setStatus('Iniciá sesión desde Profile antes de enviar la solicitud.');
      return;
    }

    setBusy(true);
    setStatus('Enviando solicitud al queue de Engineering...');

    const result = await apiRequest('/api/forms/engineering', {
      method: 'POST',
      body: {
        name: name || 'Engineering client',
        email: email || 'engineering@slt.local',
        subject: activeTool,
        message: brief,
        tool: activeTool,
        kind: 'engineering',
      },
    });

    if (result.ok) {
      setStatus(result.data?.message || 'Solicitud recibida. El equipo la revisará.');
      setBrief('');
    } else {
      setStatus(result.message || 'No se pudo registrar la solicitud.');
    }
    setBusy(false);
  };

  return (
    <div className="studio studio-container">
      <aside className="studio-rail">
        <p className="studio-rail-label">Tools</p>
        <ul className="studio-tool-list">
          {TOOLS.map(({ label, desc, path }) => (
            <li key={label}>
              <button
                type="button"
                className={`studio-tool-item ${activeTool === label ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTool(label);
                  if (path !== '/engineering') navigate(path);
                }}
              >
                <span className="studio-tool-label">{label}</span>
                <span className="studio-tool-desc">{desc}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="studio-rail-label studio-rail-label--offset">Actions</p>
        <ul className="studio-tool-list">
          {ACTIONS.map(({ label, desc, path }) => (
            <li key={label}>
              <button type="button" className="studio-tool-item" onClick={() => navigate(path)}>
                <span className="studio-tool-label">{label}</span>
                <span className="studio-tool-desc">{desc}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="studio-main">
        <header>
          <h1 className="studio-main-title">Engineering Lab</h1>
          <p className="studio-main-meta">{activeTool} · Intake queue active</p>
        </header>

        <section className="studio-glass-panel">
          <p className="studio-rail-label">Project brief</p>
          <div className="studio-input-bar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <input
              className="studio-input"
              placeholder="Nombre del proyecto"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="studio-input"
              placeholder="Email de contacto"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <textarea
              className="studio-input"
              rows={6}
              placeholder="Describí la app, juego, automatización o herramienta que necesitás..."
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
          </div>
        </section>

        <div className="studio-controls">
          <button type="button" className="studio-action" disabled={busy} onClick={handleExecute}>
            [ Execute ]
          </button>
          <Link to="/contact" className="studio-action">[ Contact team ]</Link>
          {status ? <span className="studio-meta">{status}</span> : null}
        </div>
      </main>

      <aside className="studio-aside">
        <p className="studio-aside-label">Roadmap</p>
        <ul className="studio-phase-list">
          {ROADMAP.map(({ phase, status: phaseStatus }) => (
            <li key={phase} className="studio-phase-item">
              <span>{phase}</span>
              <span>{phaseStatus}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
