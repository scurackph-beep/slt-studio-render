import { useEffect, useState } from 'react';
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
  { label: 'Dashboard', active: true },
  { label: 'Projects' },
  { label: 'Library' },
  { label: 'Messaging', badge: 3 },
  { label: 'Calendar' },
  { label: 'Clients' },
  { label: 'Reports' },
  { label: 'Settings' },
];

const PLANS = ['Free', 'Pro', 'Studio', 'Business', 'Creator'];

export default function CEODashboard() {
  const [playing, setPlaying] = useState(false);
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

  return (
    <div className="ceo">
      <header className="ceo-header">
        <div>
          <span className="ceo-greeting">Welcome back, CEO.</span>
          <h1 className="ceo-headline">Good evening. Let's make something honest.</h1>
        </div>
        <div className="ceo-header-actions">
          <input type="text" className="ceo-search-input" placeholder="Search across studio..." />
          <button type="button" className="studio-action">[ Notify ]</button>
          <button type="button" className="studio-action">[ New Project ]</button>
        </div>
      </header>

      <nav className="studio-toggle-row" aria-label="Dashboard navigation">
        {NAV_ITEMS.map(({ label, active, badge }) => (
          <button
            key={label}
            type="button"
            className={`studio-action ${active ? 'is-active' : ''}`}
          >
            [ {label}{badge ? ` · ${badge}` : ''} ]
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
                onChange={(e) => setSelectedPlan(e.target.value)}
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
                <button type="button" className="studio-action studio-preview-action">[ Play ]</button>
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
              <button type="button" className="studio-action">[ View ]</button>
              <button type="button" className="studio-action">[ Edit ]</button>
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
            <select className="studio-select">
              <option>Deep Work</option>
              <option>Creative Flow</option>
              <option>Admin Tasks</option>
            </select>
            <div className="ceo-focus-row">
              <span className="ceo-focus-time">45 min</span>
              <button type="button" className="studio-action">[ Start ]</button>
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
              <button type="button" className="studio-action" onClick={() => setPlaying(!playing)}>
                {playing ? '[ Pause ]' : '[ Play ]'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
