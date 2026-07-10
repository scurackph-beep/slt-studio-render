import { NavLink } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import './Navbar.css';

export default function Navbar({ links = [], activeId, onNavigate, mode = 'route' }) {
  return (
    <header className="navbar" role="banner">
      <div className="navbar-inner">
        <BrandLogo className="navbar-logo" />

        <nav className="navbar-links" aria-label="Main navigation">
          {links.map((link) => {
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
      </div>
    </header>
  );
}
