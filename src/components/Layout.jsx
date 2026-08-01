import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import SiteReport from './SiteReport';
import './Layout.css';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About Us' },
  { path: '/sitemap', label: 'Mapa del sitio' },
  { path: '/subscription', label: 'Planes' },
  { path: '/careers', label: 'Careers' },
  { path: '/help', label: 'Ayuda y soporte' },
];

const HOME_GALA_NAV_LINKS = [
  { path: '/about?view=main-site', label: 'Main Site' },
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About Us' },
  { path: '/library?view=institutional', label: 'Institutional Gallery' },
  { path: '/sitemap', label: 'Sitemap' },
  { path: '/subscription', label: 'Subscription' },
  { path: '/careers', label: 'Careers' },
  { path: '/help', label: 'Help' },
];

export default function Layout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className={`layout ${isHome ? 'layout--home-gala' : ''}`}>
      <Navbar links={isHome ? HOME_GALA_NAV_LINKS : NAV_LINKS} mode="route" gala={isHome} />
      <main className="main-content">
        <div key={location.pathname} className="page-container page-rise">
          <Outlet />
        </div>
      </main>
      <SiteReport />
    </div>
  );
}
