import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';
import BrandLogo from './BrandLogo';
import './Navbar.css';

const DEFAULT_LINKS = [
  { label: 'Who We Are', path: '/about' },
  { label: 'Careers', path: '/careers' },
  { label: 'Site Map', path: '/sitemap' },
  { label: 'Privacy', path: '/privacy' },
  { label: 'Terms', path: '/terms' },
  { label: 'Subscription', path: '/subscription' },
  { label: 'Library', path: '/library' },
  { label: 'Help', path: '/help' },
  { label: 'Contact', path: '/contact' },
];

function formatCredits(value) {
  if (typeof value !== 'number') return null;
  return `${new Intl.NumberFormat('en-US').format(value)} credits`;
}

export default function Navbar({ links = [], activeId, onNavigate, mode = 'route', gala = false }) {
  const items = links.length ? links : DEFAULT_LINKS;
  const { credits, heldCredits } = useStudio();
  const { isAuthenticated, isCEO, session } = useAuth();

  const accountLabel = isCEO
    ? 'CEO mode'
    : isAuthenticated
      ? (session?.email || session?.username || 'Account')
      : 'Sign in';

  const creditsLabel = formatCredits(credits);

  return (
    <header className={`navbar ${gala ? 'navbar--gala' : ''}`} role="banner">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand" aria-label="Sweet Little Trauma Studio home">
          {gala ? (
            <img
              className="navbar-gala-lockup"
              src="/assets/home-gala/01-brand/brand-lockup-ai-no-screws-v2.png"
              alt="Sweet Little Trauma Studio AI"
            />
          ) : (
            <BrandLogo className="navbar-logo" variant="compact" />
          )}
        </Link>

        <nav className="navbar-links" aria-label="Main navigation">
          {items.map((link) => {
            const key = link.id ?? link.path ?? link.label;

            if (mode === 'scroll') {
              return (
                <button
                  key={key}
                  type="button"
                  className={`navbar-link ${activeId === link.label ? 'is-active' : ''}`}
                  onClick={() => onNavigate?.(link)}
                >
                  {link.label}
                </button>
              );
            }

            return (
              <NavLink
                key={key}
                to={link.path}
                end={link.path === '/'}
                className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}
              >
                {link.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="navbar-account" aria-label="Account status">
          {creditsLabel ? (
            <span
              className="navbar-credits"
              title={heldCredits ? `${heldCredits} credits reserved` : 'Available credits'}
            >
              {creditsLabel}
            </span>
          ) : null}
          <Link
            to="/profile"
            className={`navbar-account-link ${isAuthenticated ? 'is-connected' : ''} ${isCEO ? 'is-ceo' : ''}`}
            aria-label={accountLabel}
            title={accountLabel}
          >
            <span className="navbar-profile-dot" aria-hidden="true" />
            {gala ? (
              <img
                className="navbar-gala-profile"
                src="/assets/home-gala/04-effects/profile-glyph-white.png"
                alt=""
                aria-hidden="true"
              />
            ) : null}
            <span className="navbar-account-text">{accountLabel}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
