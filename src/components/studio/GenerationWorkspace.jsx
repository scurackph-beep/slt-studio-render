import { useState } from 'react';
import { Menu, PanelRight, X } from 'lucide-react';
import './generation-studio.css';

export default function GenerationWorkspace({
  title,
  subtitle,
  meta,
  sidebar,
  canvas,
  history,
  className = '',
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <section className={`gen-workspace ${className}`.trim()}>
      <header className="gen-workspace-header">
        <div className="gen-workspace-header-copy">
          <p className="gen-workspace-eyebrow">AI Generation Studio</p>
          <h1>{title}</h1>
          {subtitle ? <p className="gen-workspace-subtitle">{subtitle}</p> : null}
        </div>
        <div className="gen-workspace-header-meta">{meta}</div>
        <div className="gen-workspace-mobile-actions">
          <button type="button" className="gen-icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open configuration">
            <Menu size={18} />
          </button>
          <button type="button" className="gen-icon-button" onClick={() => setHistoryOpen(true)} aria-label="Open history">
            <PanelRight size={18} />
          </button>
        </div>
      </header>

      <div className="gen-workspace-grid">
        <aside className={`gen-workspace-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
          <div className="gen-panel-mobile-head">
            <span>Configuration</span>
            <button type="button" className="gen-icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close configuration">
              <X size={18} />
            </button>
          </div>
          {sidebar}
        </aside>

        <main className="gen-workspace-main">{canvas}</main>

        <aside className={`gen-workspace-history ${historyOpen ? 'is-open' : ''}`}>
          <div className="gen-panel-mobile-head">
            <span>History</span>
            <button type="button" className="gen-icon-button" onClick={() => setHistoryOpen(false)} aria-label="Close history">
              <X size={18} />
            </button>
          </div>
          {history}
        </aside>
      </div>

      {(sidebarOpen || historyOpen) ? (
        <button
          type="button"
          className="gen-workspace-scrim"
          aria-label="Close panels"
          onClick={() => {
            setSidebarOpen(false);
            setHistoryOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
