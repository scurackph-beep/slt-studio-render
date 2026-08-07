import { useState } from 'react';
import './StudioErrorPanel.css';

export default function StudioErrorPanel({ incident, actionMessage = '', busy = false, onReport, onRetry }) {
  const [copied, setCopied] = useState(false);
  if (!incident) return null;

  const coupon = incident.compensation;
  const copyCoupon = async () => {
    if (!coupon?.code) return;
    await navigator.clipboard.writeText(coupon.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="studio-error-panel" role="alert" aria-labelledby="studio-error-title">
      <div className="studio-error-heading">
        <div>
          <p>Generation incident</p>
          <h2 id="studio-error-title">WE&apos;RE SORRY.</h2>
        </div>
        <span>{incident.errorCode || 'SLT ERROR'}</span>
      </div>

      <p className="studio-error-message">{incident.customerMessage}</p>
      <dl className="studio-error-facts">
        <div><dt>Incident</dt><dd>{incident.incidentId || 'Pending'}</dd></div>
        <div><dt>Credits</dt><dd>{incident.reservationReleased ? 'Reserved credits returned' : 'No credit movement confirmed'}</dd></div>
        {incident.provider ? <div><dt>Provider</dt><dd>{incident.provider}</dd></div> : null}
      </dl>

      {coupon ? (
        <div className="studio-error-compensation">
          <div><strong>{coupon.discountPercent || 5}% courtesy credit</strong><span>One use · linked to your account</span></div>
          <button type="button" onClick={copyCoupon} title="Copy compensation code">{copied ? 'Copied' : coupon.code}</button>
        </div>
      ) : null}

      <div className="studio-error-actions">
        <button type="button" disabled={busy || incident.reported} onClick={() => onReport?.()}>
          {incident.reported ? 'Report sent' : 'Send to technical team'}
        </button>
        {incident.retryable && incident.jobId ? (
          <button type="button" className="is-primary" disabled={busy} onClick={() => onRetry?.()}>
            {busy ? 'Starting new Job...' : 'Try again'}
          </button>
        ) : null}
      </div>
      {actionMessage ? <p className="studio-error-action-message">{actionMessage}</p> : null}
    </section>
  );
}
