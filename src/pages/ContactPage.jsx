import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { submitPlatformForm } from '../lib/api-client';
import './StudioLayout.css';

const FORM_TYPES = [
  { value: 'contact', label: 'General Contact' },
  { value: 'support', label: 'Support' },
  { value: 'careers', label: 'Careers' },
  { value: 'sales', label: 'Business Inquiry' },
  { value: 'bug', label: 'Report a Problem' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'subscription-cancel', label: 'Cancel Subscription' },
  { value: 'account-recovery', label: 'Account Recovery' },
];

function safeInitialKind(value) {
  return FORM_TYPES.some((item) => item.value === value) ? value : 'contact';
}

export default function ContactPage() {
  const [searchParams] = useSearchParams();
  const [kind, setKind] = useState(() => safeInitialKind(searchParams.get('kind')));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedLabel = useMemo(
    () => FORM_TYPES.find((item) => item.value === kind)?.label || 'General Contact',
    [kind],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');
    if (message.trim().length < 8) {
      setError('Write at least 8 characters so the team has context.');
      return;
    }
    setBusy(true);
    const result = await submitPlatformForm(kind, {
      name,
      email,
      subject: subject || selectedLabel,
      message,
      source: 'contact-page',
    });
    if (!result.ok) {
      setError(result.message || result.data?.readableError || 'Could not send this request.');
      setBusy(false);
      return;
    }
    setStatus('Request received and stored for follow-up.');
    setName('');
    setEmail('');
    setSubject('');
    setMessage('');
    setBusy(false);
  };

  return (
    <section className="info-page contact-page">
      <p className="studio-rail-label">Contact</p>
      <h1 className="info-page-title">Talk to Sweet Little Trauma Studio.</h1>
      <p className="info-page-body">
        Send support, careers, business or product requests. The backend stores every submission for follow-up.
      </p>

      <form className="profile-login contact-form" onSubmit={handleSubmit}>
        <label>
          <span>Request type</span>
          <select className="studio-select" value={kind} onChange={(event) => setKind(event.target.value)}>
            {FORM_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        </label>
        <label>
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={selectedLabel} />
        </label>
        <label>
          <span>Message</span>
          <textarea
            className="studio-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Tell us what you need..."
            rows={6}
          />
        </label>
        <button type="submit" className="video-primary-button" disabled={busy || message.trim().length < 8}>
          {busy ? 'Sending...' : 'Send request'}
        </button>
      </form>

      {status ? <p className="studio-async-note">{status}</p> : null}
      {error ? <p className="studio-error-note">{error}</p> : null}
    </section>
  );
}
