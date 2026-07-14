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
  if (typeof value !== 'number') return 'CR --';
  return `${new Intl.NumberFormat('en-US').format(value)} CR`;
}

export default function Navbar({ links = [], activeId, onNavigate, mode = 'route' }) {
  const items = links.length ? links : DEFAULT_LINKS;
  const { credits, heldCredits } = useStudio();
  const { isAuthenticated, isCEO, session } = useAuth();

  const accountLabel = isCEO
    ? 'CEO mode'
    : isAuthenticated
      ? (session?.email || session?.username || 'Connected')
      : 'Sign in';

  return (
    <header className="navbar" role="banner">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand" aria-label="Sweet Little Trauma Studio home">
          <BrandLogo className="navbar-logo" variant="compact" />
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
          <span className="navbar-credits" title={heldCredits ? `${heldCredits} credits reserved` : 'Available credits'}>
            {formatCredits(credits)}
          </span>
          <Link
            to="/profile"
            className={`navbar-profile ${isAuthenticated ? 'is-connected' : ''} ${isCEO ? 'is-ceo' : ''}`}
            aria-label={accountLabel}
            title={accountLabel}
          >
            <span className="navbar-profile-dot" />
            <span className="navbar-profile-line" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
