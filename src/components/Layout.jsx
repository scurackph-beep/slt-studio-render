import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import './Layout.css';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/video', label: 'Video' },
  { path: '/music', label: 'Music' },
  { path: '/image', label: 'Image' },
  { path: '/sound', label: 'Sound' },
  { path: '/library', label: 'Library' },
  { path: '/contact', label: 'Contact' },
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
    </div>
  );
}
