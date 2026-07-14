import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guestQuotaSnapshot } from '../lib/access-control';

const SITE_AREAS = [
  ['Home', 'AI chat intake, primary creative categories and guided creation entry.'],
  ['Image Studio', 'Generate images, avatars, references and visual concepts.'],
  ['Video Studio', 'Text to video, image to video, lip sync and motion/scene workflows.'],
  ['Sound FX', 'Sound effect creation and audio design requests.'],
  ['Music Studio', 'Song, melody and assisted music creation workflows.'],
  ['Fashion', 'Clothing concepts, looks and visual fashion production requests.'],
  ['Engineering', 'Apps, games, automations, software and custom build requests.'],
  ['Library', 'Projects, generated assets and production history.'],
  ['Profile', 'User login, CEO mode, account state and settings.'],
  ['Support', 'Contact, help, careers, privacy, terms, sitemap and subscriptions.'],
];

export default function SiteReport() {
  const { session, isCEO, isGuest, isSpy } = useAuth();
  const [open, setOpen] = useState(false);
  const quota = useMemo(() => (isGuest ? guestQuotaSnapshot(session) : null), [isGuest, session]);

  const accessLabel = isCEO ? 'CEO full access' : isGuest ? 'Guest limited access' : isSpy ? 'Spy read-only' : 'User access';

  return (
    <>
      <button type="button" className="site-report-trigger" onClick={() => setOpen(true)} aria-label="Open site report">
        <span className="site-report-face" aria-hidden="true">
          <span />
        </span>
        <strong>REPORTE</strong>
      </button>

      {open ? (
        <aside className="site-report-panel" role="dialog" aria-modal="false" aria-label="Site report">
          <div className="site-report-header">
            <div>
              <p>SLT Site Report</p>
              <h2>Platform breakdown</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close report">×</button>
          </div>

          <div className="site-report-status">
            <span>Access</span>
            <strong>{accessLabel}</strong>
          </div>

          {quota ? (
            <div className="site-report-quota">
              {Object.entries(quota).map(([kind, item]) => (
                <span key={kind}>
                  {kind}: {item.remaining}/{item.limit}
                </span>
              ))}
            </div>
          ) : null}

          <div className="site-report-list">
            {SITE_AREAS.map(([title, body]) => (
              <section key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </section>
            ))}
          </div>
        </aside>
      ) : null}
    </>
  );
}
