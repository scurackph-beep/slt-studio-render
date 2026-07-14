import { useState } from 'react';
import { Link } from 'react-router-dom';
import { submitPlatformForm } from '../lib/api-client';
import './StudioLayout.css';

const PAGES = {
  about: {
    eyebrow: 'About Us',
    title: 'Sweet Little Trauma Studio is a creative AI production system.',
    body: 'A platform for image, video, music, sound, fashion, engineering and virtual assistance. The goal is to help people move from idea to production without getting lost in tools.',
    actions: [{ label: 'Start Creating', to: '/' }],
  },
  careers: {
    eyebrow: 'Careers',
    title: 'Work with us.',
    body: 'We welcome collaborators, developers, designers, editors, prompt artists, producers and AI operators. Submit your application below.',
    hasForm: true,
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Privacy Policy.',
    body: 'This page is ready for the final legal privacy policy. It should describe data collection, account data, uploaded files, generation history, cookies and provider processing.',
    actions: [{ label: 'Contact Support', to: '/contact' }],
  },
  terms: {
    eyebrow: 'Terms',
    title: 'Terms and Conditions.',
    body: 'This page is ready for the final legal terms, including acceptable use, subscription rules, credits, refunds, generated content, licenses and service availability.',
    actions: [{ label: 'Planes', to: '/subscription' }],
  },
  sitemap: {
    eyebrow: 'Mapa del sitio',
    title: 'Main areas.',
    body: 'Home, Image Studio, Video Studio, Music Studio, Sound FX Studio, Library, Fashion Studio, Engineering Lab, Virtual Assist, Billing, Profile, Settings, Help and Contact.',
    actions: [
      { label: 'Image', to: '/image' },
      { label: 'Video', to: '/video' },
      { label: 'Music', to: '/music' },
      { label: 'Sound', to: '/sound' },
      { label: 'Library', to: '/library' },
      { label: 'Fashion', to: '/fashion' },
      { label: 'Engineering', to: '/engineering' },
    ],
  },
  subscription: {
    eyebrow: 'Planes',
    title: 'Plans and credits.',
    body: 'This section connects to Stripe through the backend. The current backend already includes subscription, billing, checkout and credit-pack routes.',
    actions: [{ label: 'Open Studio', to: '/' }],
  },
  profile: {
    eyebrow: 'Profile',
    title: 'Your creative profile.',
    body: 'This area is ready for login, account identity, saved preferences, plan status and generation history.',
    actions: [{ label: 'Settings', to: '/settings' }],
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Studio settings.',
    body: 'This area is prepared for language, theme, default providers, API routing preferences, safety settings and storage options.',
    actions: [{ label: 'Ayuda y soporte', to: '/help' }],
  },
  help: {
    eyebrow: 'Ayuda y soporte',
    title: 'How can we help?',
    body: 'Use the Home assistant to describe what you want. The system will guide you to the right studio, action and provider. You can also send a support request from Contact.',
    actions: [{ label: 'Go Home', to: '/' }, { label: 'Contact', to: '/contact?kind=support' }],
  },
  assist: {
    eyebrow: 'Virtual Assist',
    title: 'Ask the studio assistant.',
    body: 'The central assistant lives on the Home page. It helps choose the right category, tool, provider and next step.',
    actions: [{ label: 'Open Assistant', to: '/' }],
  },
  'not-found': {
    eyebrow: '404',
    title: 'This area is not ready yet.',
    body: 'The route exists as a safe fallback so the app does not break while the product grows.',
    actions: [{ label: 'Back Home', to: '/' }],
  },
};

function CareersApplicationForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');
    if (message.trim().length < 8) {
      setError('Write at least 8 characters about your experience and interest.');
      return;
    }
    setBusy(true);
    const result = await submitPlatformForm('careers', {
      name,
      email,
      subject: role || 'Careers application',
      message: [portfolio ? `Portfolio: ${portfolio}` : null, message].filter(Boolean).join('\n\n'),
      source: 'careers-page',
    });
    if (!result.ok) {
      setError(result.message || result.data?.readableError || 'Could not send this application.');
      setBusy(false);
      return;
    }
    setStatus('Application received. We will review it and follow up by email.');
    setName('');
    setEmail('');
    setRole('');
    setPortfolio('');
    setMessage('');
    setBusy(false);
  };

  return (
    <>
      <form className="profile-login contact-form" onSubmit={handleSubmit}>
        <label>
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
        </label>
        <label>
          <span>Role / specialty</span>
          <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Designer, developer, editor..." />
        </label>
        <label>
          <span>Portfolio or links</span>
          <input value={portfolio} onChange={(event) => setPortfolio(event.target.value)} placeholder="Website, reel, GitHub, Behance..." />
        </label>
        <label>
          <span>Why do you want to join?</span>
          <textarea
            className="studio-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Tell us about your experience and what you want to build with us..."
            rows={6}
            required
          />
        </label>
        <button type="submit" className="video-primary-button" disabled={busy || message.trim().length < 8}>
          {busy ? 'Sending...' : 'Submit application'}
        </button>
      </form>
      {status ? <p className="studio-async-note">{status}</p> : null}
      {error ? <p className="studio-error-note">{error}</p> : null}
    </>
  );
}

export default function InfoPage({ type = 'about' }) {
  const page = PAGES[type] || PAGES.about;

  return (
    <section className="info-page">
      <p className="studio-rail-label">{page.eyebrow}</p>
      <h1 className="info-page-title">{page.title}</h1>
      <p className="info-page-body">{page.body}</p>

      {page.hasForm ? <CareersApplicationForm /> : null}

      {page.actions?.length ? (
        <div className="info-page-actions">
          {page.actions.map((action) => (
            <Link key={`${action.to}-${action.label}`} to={action.to} className="studio-action">
              [ {action.label} ]
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
