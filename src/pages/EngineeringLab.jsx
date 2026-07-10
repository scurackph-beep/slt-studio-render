import './StudioLayout.css';

const TOOLS = [
  { label: 'App Library', desc: 'Explore our applications' },
  { label: 'Game Library', desc: 'Discover and play games' },
  { label: 'Custom App Request', desc: 'Request a custom app' },
  { label: 'Business Automation', desc: 'Streamline processes' },
  { label: 'Creative Tools', desc: 'Design, edit, create' },
  { label: 'Prototype Lab', desc: 'Test ideas & prototype' },
];

const ACTIONS = [
  { label: 'Client Dashboard', desc: 'Project progress' },
  { label: 'Premium Access', desc: 'Unlock premium' },
  { label: 'Support', desc: 'Get help' },
  { label: 'Legal', desc: 'Terms & privacy' },
  { label: 'Pricing', desc: 'Plans & pricing' },
  { label: 'Submit Idea', desc: 'Share your idea', highlight: true },
];

const PHASES = [
  { phase: 'Request', status: 'Completed' },
  { phase: 'Planning', status: 'Completed' },
  { phase: 'Design', status: 'In Progress' },
  { phase: 'Build', status: 'Pending' },
  { phase: 'Test', status: 'Pending' },
  { phase: 'Final', status: 'Pending' },
  { phase: 'Ready', status: 'Pending' },
];

export default function EngineeringLab() {
  return (
    <div className="studio">
      <aside className="studio-rail">
        <p className="studio-rail-label">Tools</p>
        <ul className="studio-tool-list">
          {TOOLS.map(({ label, desc }) => (
            <li key={label}>
              <button type="button" className="studio-tool-item">
                <span className="studio-tool-label">{label}</span>
                <span className="studio-tool-desc">{desc}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="studio-rail-label studio-rail-label--offset">Actions</p>
        <ul className="studio-tool-list">
          {ACTIONS.map(({ label, desc, highlight }) => (
            <li key={label}>
              <button type="button" className={`studio-tool-item ${highlight ? 'is-active' : ''}`}>
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
          <p className="studio-main-meta">Building tools. Solving problems. Creating impact.</p>
        </header>

        <div className="studio-image-grid">
          <p>Select a tool from the left to start building.</p>
        </div>
      </main>

      <aside className="studio-aside">
        <p className="studio-aside-label">Client Dashboard</p>

        <div className="studio-project-row">
          <div>
            <p className="studio-control-label">Project</p>
            <p className="studio-project-title">Smart Inventory App</p>
            <p className="studio-project-sub">In Progress · 65%</p>
          </div>
        </div>

        <p className="studio-meta" style={{ marginBottom: 24 }}>Estimated Completion: Aug 2026</p>

        <ul className="studio-phase-list">
          {PHASES.map(({ phase, status }) => (
            <li key={phase} className="studio-phase-item">
              <span>{phase}</span>
              <span>{status}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
