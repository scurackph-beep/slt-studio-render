import { Link } from 'react-router-dom';
import './StudioLayout.css';

const PAGES = {
  about: {
    eyebrow: 'Who We Are',
    title: 'Sweet Little Trauma Studio is a creative AI production system.',
    body: 'A platform for image, video, music, sound, fashion, engineering and virtual assistance. The goal is to help people move from idea to production without getting lost in tools.',
    actions: [{ label: 'Start Creating', to: '/' }],
  },
  careers: {
    eyebrow: 'Careers',
    title: 'Work with us.',
    body: 'This area is prepared for collaborators, developers, designers, editors, prompt artists, producers and AI operators.',
    actions: [{ label: 'Contact', to: '/contact' }],
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
    actions: [{ label: 'Subscription', to: '/subscription' }],
  },
  sitemap: {
    eyebrow: 'Site Map',
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
    eyebrow: 'Subscription',
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
    actions: [{ label: 'Help', to: '/help' }],
  },
  help: {
    eyebrow: 'Help',
    title: 'How can we help?',
    body: 'Use the Home command center to describe what you want. The system will guide you to the right studio, action and provider.',
    actions: [{ label: 'Go Home', to: '/' }],
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

export default function InfoPage({ type = 'about' }) {
  const page = PAGES[type] || PAGES.about;

  return (
    <section className="info-page">
      <p className="studio-rail-label">{page.eyebrow}</p>
      <h1 className="info-page-title">{page.title}</h1>
      <p className="info-page-body">{page.body}</p>

      <div className="info-page-actions">
        {page.actions.map((action) => (
          <Link key={`${action.to}-${action.label}`} to={action.to} className="studio-action">
            [ {action.label} ]
          </Link>
        ))}
      </div>
    </section>
  );
}
