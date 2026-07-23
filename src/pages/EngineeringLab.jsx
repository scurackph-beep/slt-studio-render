import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, assistStudio, readableStudioMessage } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { canUseGuestQuota, consumeGuestQuota } from '../lib/access-control';
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

const PROCESS_STEPS = [
  {
    title: '1. Order',
    body: 'A request becomes an Engineering Order: app, website, game, automation, dashboard, AI agent or internal tool.',
  },
  {
    title: '2. Technical brief',
    body: 'The brief is translated into scope, features, risks, assets needed, integrations and a first production path.',
  },
  {
    title: '3. Review',
    body: 'SLT reviews feasibility, APIs, timeline and whether the build should be handled internally or prepared for Codex/Cursor.',
  },
  {
    title: '4. Build queue',
    body: 'Approved orders move into the build queue. Public users never run code directly against your project.',
  },
];

export default function EngineeringLab() {
  const navigate = useNavigate();
  const { session, isAuthenticated, isGuest, isSpy } = useAuth();
  const [activeTool, setActiveTool] = useState('Custom App Request');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [brief, setBrief] = useState('');
  const [status, setStatus] = useState('');
  const [technicalPlan, setTechnicalPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);

  const handleExecute = async () => {
    if (!brief.trim() || brief.trim().length < 12) {
      setStatus('Escribí un brief más detallado (mínimo 12 caracteres).');
      return;
    }
    if (isSpy) {
      setStatus('Spy mode is read-only. Use a user, CEO or guest access to send Engineering requests.');
      return;
    }
    if (isGuest && !canUseGuestQuota('engineering', session)) {
      setStatus('Guest quota reached for Engineering. This guest pass allows 2 engineering requests.');
      return;
    }
    if (!isAuthenticated) {
      setStatus('Log in from Profile before sending an Engineering request.');
      return;
    }

    setBusy(true);
    setStatus('Sending request to the Engineering queue...');

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
      if (isGuest) consumeGuestQuota('engineering', session);
      setStatus(result.data?.message || 'Solicitud recibida. El equipo la revisará.');
      setBrief('');
    } else {
      setStatus(result.message || 'No se pudo registrar la solicitud.');
    }
    setBusy(false);
  };

  const handlePreparePlan = async () => {
    if (!brief.trim() || brief.trim().length < 12) {
      setStatus('Write a clearer order first so the assistant can prepare a useful technical plan.');
      return;
    }
    if (isSpy) {
      setStatus('Spy mode is read-only. Use user, CEO or guest access to prepare an Engineering plan.');
      return;
    }
    if (!isAuthenticated) {
      setStatus('Log in from Profile before using the Engineering assistant.');
      return;
    }

    setPlanning(true);
    setStatus('Preparing technical plan with the studio assistant...');
    const prompt = [
      'You are the Engineering Intake Agent for Sweet Little Trauma Studio.',
      'Turn this client request into a concise technical plan.',
      'Include: product type, required features, required APIs/integrations, assets/files needed, execution risks, first milestone, and whether this should be routed to Codex/Cursor only under CEO/admin supervision.',
      `Selected order type: ${activeTool}`,
      `Client name/project: ${name || 'Not provided'}`,
      `Contact email: ${email || 'Not provided'}`,
      `Order brief: ${brief}`,
    ].join('\n');

    const result = await assistStudio({
      title: 'Engineering Intake Agent',
      provider: 'OpenAI',
      prompt,
    });

    if (result.ok) {
      setTechnicalPlan(
        result.data?.historyItem?.response
        || result.data?.success
        || 'Technical plan prepared.',
      );
      setStatus('Technical plan ready. Submit the order when it looks correct.');
    } else {
      setStatus(readableStudioMessage(result.message || result.data?.readableError || result.data?.error));
    }
    setPlanning(false);
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
          <p className="studio-rail-label">How Engineering orders work</p>
          <p className="studio-main-meta">
            Engineering is not an instant generator. It creates an order for software, apps, games,
            automations, dashboards, AI agents or custom tools. The order is stored, reviewed and
            translated into a technical production plan before any code execution happens.
          </p>
          <div className="studio-tags">
            <span className="studio-tag">Order first</span>
            <span className="studio-tag">Assistant planning</span>
            <span className="studio-tag">CEO/admin execution</span>
          </div>
          <ul className="studio-phase-list engineering-process-list">
            {PROCESS_STEPS.map((step) => (
              <li key={step.title} className="studio-phase-item">
                <span>{step.title}</span>
                <span>{step.body}</span>
              </li>
            ))}
          </ul>
          <p className="studio-main-meta">
            Best route now: the public site submits the order and can ask the existing studio
            assistant API to prepare a technical plan. Direct Codex/Cursor execution should stay
            private for CEO/admin use because it can touch real code, deployments and credentials.
          </p>
        </section>

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
          <button type="button" className="studio-action" disabled={planning || busy} onClick={handlePreparePlan}>
            [ {planning ? 'Planning' : 'Prepare technical plan'} ]
          </button>
          <button type="button" className="studio-action" disabled={busy} onClick={handleExecute}>
            [ Submit order ]
          </button>
          <Link to="/contact" className="studio-action">[ Contact team ]</Link>
          {status ? <span className="studio-meta">{status}</span> : null}
        </div>

        {technicalPlan ? (
          <section className="studio-glass-panel">
            <p className="studio-rail-label">Technical plan</p>
            <p className="studio-main-meta">{technicalPlan}</p>
          </section>
        ) : null}
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
