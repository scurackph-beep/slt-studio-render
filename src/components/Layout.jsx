import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import SiteReport from './SiteReport';
import './Layout.css';

const NAV_LINKS = [
  { path: '/about', label: 'About Us' },
  { path: '/sitemap', label: 'Site Map' },
  { path: '/subscription', label: 'Plans' },
  { path: '/careers', label: 'Careers' },
  { path: '/help', label: 'Help' },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="layout">
      <Navbar links={NAV_LINKS} mode="route" />
      <main className="main-content">
        <div key={location.pathname} className="page-container page-rise">
          <Outlet />
        </div>
      </main>
      <SiteReport />
    </div>
  );
}
