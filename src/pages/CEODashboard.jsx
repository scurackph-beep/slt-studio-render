import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudio } from '../context/StudioContext';
import {
  createCreditsCheckout,
  createStripeCheckout,
  fetchCreditPacks,
  openStripePortal,
  readableStudioMessage,
  updateSubscription,
} from '../lib/api-client';
import { readStore, storageKeys } from '../lib/storage';
import './StudioLayout.css';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/ceo', active: true },
  { label: 'Projects', path: '/library' },
  { label: 'Library', path: '/library' },
  { label: 'Messaging', path: '/contact' },
  { label: 'Calendar', path: '/ceo' },
  { label: 'Clients', path: '/contact' },
  { label: 'Reports', path: '/ceo' },
  { label: 'Settings', path: '/settings' },
];

const PLANS = ['Free', 'Pro', 'Studio', 'Business', 'Creator'];

export default function CEODashboard() {
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [search, setSearch] = useState('');
  const [focusMode, setFocusMode] = useState('Deep Work');
  const [focusSeconds, setFocusSeconds] = useState(45 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('Creator');
  const [creditPacks, setCreditPacks] = useState([]);
  const [billingStatus, setBillingStatus] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);
  const { plan, planStatus, credits, billing, refresh } = useStudio();

  useEffect(() => {
    fetchCreditPacks().then((result) => {
      if (result.ok && Array.isArray(result.data.packs)) {
        setCreditPacks(result.data.packs);
      }
    });
  }, []);

  useEffect(() => {
    if (!focusRunning || focusSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setFocusSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusRunning, focusSeconds]);

  const userEmail = readStore(storageKeys.user, {})?.email || 'info@studiosweetlittletrauma.com';

  const handleCheckout = async () => {
    setBillingBusy(true);
    setBillingStatus('Opening checkout…');
    const result = await createStripeCheckout(selectedPlan, userEmail);
    if (result.ok && result.data.checkout?.url) {
      window.location.href = result.data.checkout.url;
      return;
    }
    setBillingStatus(readableStudioMessage(result.message));
    setBillingBusy(false);
  };

  const handlePortal = async () => {
    setBillingBusy(true);
    setBillingStatus('Opening billing portal…');
    const result = await openStripePortal();
    if (result.ok && result.data.portal?.url) {
      window.location.href = result.data.portal.url;
      return;
    }
    setBillingStatus(readableStudioMessage(result.message));
    setBillingBusy(false);
  };

  const handleCredits = async () => {
    const pack = creditPacks[0];
    if (!pack?.id) {
      setBillingStatus('No credit packs available.');
      return;
    }
    setBillingBusy(true);
    setBillingStatus('Opening credit checkout…');
    const result = await createCreditsCheckout(pack.id, userEmail);
    if (result.ok && result.data.checkout?.url) {
      window.location.href = result.data.checkout.url;
      return;
    }
    setBillingStatus(readableStudioMessage(result.message));
    setBillingBusy(false);
  };

  const handleCancel = async () => {
    setBillingBusy(true);
    const result = await updateSubscription('cancel', plan, 'CEO dashboard');
    setBillingStatus(result.ok ? result.data.message : readableStudioMessage(result.message));
    if (result.ok) await refresh();
    setBillingBusy(false);
  };

  const handlePlayFeatured = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    await audio.play();
    setPlaying(true);
  };

  const handleSearch = () => {
    const query = search.trim();
    if (!query) return;
    if (/video|clip|film/i.test(query)) navigate(`/video?prompt=${encodeURIComponent(query)}`);
    else if (/music|song|track/i.test(query)) navigate(`/music?prompt=${encodeURIComponent(query)}`);
    else if (/image|photo|visual/i.test(query)) navigate(`/image?prompt=${encodeURIComponent(query)}`);
    else if (/sound|voice|audio/i.test(query)) navigate(`/sound?prompt=${encodeURIComponent(query)}`);
    else navigate(`/library`);
  };

  const focusLabel = `${String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:${String(focusSeconds % 60).padStart(2, '0')}`;

  return (
    <div className="ceo">
      <audio ref={audioRef} src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" onEnded={() => setPlaying(false)} />
      <header className="ceo-header">
        <div>
          <span className="ceo-greeting">Welcome back, CEO.</span>
          <h1 className="ceo-headline">Good evening. Let's make something honest.</h1>
        </div>
        <div className="ceo-header-actions">
          <input
            type="text"
            className="ceo-search-input"
            placeholder="Search across studio..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSearch();
            }}
          />
          <button type="button" className="studio-action" onClick={() => navigate('/contact')}>
            [ Notify ]
          </button>
          <button type="button" className="studio-action" onClick={() => navigate('/video')}>
            [ New Project ]
          </button>
        </div>
      </header>

      <nav className="studio-toggle-row" aria-label="Dashboard navigation">
        {NAV_ITEMS.map(({ label, path, active }) => (
          <button
            key={label}
            type="button"
            className={`studio-action ${active ? 'is-active' : ''}`}
            onClick={() => navigate(path)}
          >
            [ {label} ]
          </button>
        ))}
      </nav>

      <div className="ceo-grid">
        <div className="ceo-main">
          <section>
            <p className="ceo-section-label">Billing</p>
            <table className="studio-table ceo-billing-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{plan}</td>
                  <td>{credits ?? '—'}</td>
                  <td>{planStatus}</td>
                  <td>{billing?.paymentMethod || '—'}</td>
                </tr>
              </tbody>
            </table>
            <div className="studio-toggle-row ceo-billing-actions">
              <select
                className="studio-select"
                value={selectedPlan}
                onChange={(event) => setSelectedPlan(event.target.value)}
              >
                {PLANS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <button type="button" className="studio-action" disabled={billingBusy} onClick={handleCheckout}>
                [ Upgrade ]
              </button>
              <button type="button" className="studio-action" disabled={billingBusy} onClick={handlePortal}>
                [ Manage Billing ]
              </button>
              <button type="button" className="studio-action" disabled={billingBusy} onClick={handleCredits}>
                [ Buy Credits ]
              </button>
              <button type="button" className="studio-action" disabled={billingBusy} onClick={handleCancel}>
                [ Cancel Plan ]
              </button>
            </div>
            {billingStatus ? <p className="studio-meta ceo-billing-status">{billingStatus}</p> : null}
          </section>

          <section>
            <p className="ceo-section-label">Featured</p>
            <div className="studio-preview">
              <div className="studio-preview-inner">
                <div className="studio-media-placeholder" aria-hidden="true" />
                <p>"Ideas come to those who break rules."</p>
                <button type="button" className="studio-action studio-preview-action" onClick={handlePlayFeatured}>
                  [ {playing ? 'Pause' : 'Play'} ]
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="ceo-project-header">
              <h3>Futures Campaign</h3>
              <span className="ceo-badge">In Progress</span>
            </div>
            <p className="studio-meta">71% Complete · Due Aug 24, 2026 · On Track</p>
            <div className="ceo-project-meta">
              <button type="button" className="studio-action" onClick={() => navigate('/library')}>
                [ View ]
              </button>
              <button type="button" className="studio-action" onClick={() => navigate('/video?prompt=Futures%20campaign%20edit')}>
                [ Edit ]
              </button>
            </div>
          </section>

          <section>
            <p className="ceo-section-label">Recent Activity</p>
            <ul className="ceo-activity-list">
              <li>New assets uploaded to Brand Kit</li>
              <li>Updated Futures brief</li>
              <li>Commented on Concept v3</li>
            </ul>
          </section>
        </div>

        <aside className="ceo-widgets">
          <div className="ceo-widget">
            <h4>Current Vibe</h4>
            <span className="vibe-label">Balanced</span>
            <p>You're in a productive creative flow.</p>
          </div>

          <div className="ceo-widget">
            <h4>Focus Mode</h4>
            <select className="studio-select" value={focusMode} onChange={(event) => setFocusMode(event.target.value)}>
              <option>Deep Work</option>
              <option>Creative Flow</option>
              <option>Admin Tasks</option>
            </select>
            <div className="ceo-focus-row">
              <span className="ceo-focus-time">{focusLabel}</span>
              <button
                type="button"
                className="studio-action"
                onClick={() => {
                  if (focusRunning) {
                    setFocusRunning(false);
                    return;
                  }
                  setFocusSeconds(45 * 60);
                  setFocusRunning(true);
                }}
              >
                [ {focusRunning ? 'Pause' : 'Start'} ]
              </button>
            </div>
          </div>

          <div className="ceo-widget">
            <h4>Studio Notes</h4>
            <blockquote className="studio-quote">
              "The work is the mirror. We just hold it up."
              <cite>— Sweet Little Trauma</cite>
            </blockquote>
          </div>

          <div className="ceo-widget">
            <h4>Now Playing</h4>
            <div className="now-playing">
              <div>
                <span className="np-title">Cada Nivel</span>
                <span className="np-artist">Eduardo Scurack</span>
              </div>
              <button type="button" className="studio-action" onClick={handlePlayFeatured}>
                {playing ? '[ Pause ]' : '[ Play ]'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
