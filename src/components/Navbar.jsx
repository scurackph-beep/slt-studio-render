import { NavLink, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';
import {
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  applyLanguage,
  applyTheme,
  openTranslatedPage,
  storedLanguage,
  storedTheme,
} from '../lib/preferences';
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

export default function Navbar({ links = [], activeId, onNavigate, mode = 'route' }) {
  const items = links.length ? links : DEFAULT_LINKS;
  const { credits, heldCredits } = useStudio();
  const { isAuthenticated, isCEO, session } = useAuth();
  const [theme, setTheme] = useState(storedTheme);
  const [language, setLanguage] = useState(storedLanguage);

  const accountLabel = isCEO
    ? 'CEO mode'
    : isAuthenticated
      ? (session?.email || session?.username || 'Account')
      : 'Sign in';

  const creditsLabel = formatCredits(credits);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    if (nextLanguage !== 'en') openTranslatedPage(nextLanguage);
  };

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
          <div className="navbar-preferences" aria-label="Display preferences">
            <label>
              <span>Look</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                {THEME_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Language</span>
              <select value={language} onChange={handleLanguageChange}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
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
            <span className="navbar-account-text">{accountLabel}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
