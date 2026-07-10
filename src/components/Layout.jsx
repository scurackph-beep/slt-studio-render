import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { useStudio } from '../context/StudioContext';
import './Layout.css';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/video', label: 'Video' },
  { path: '/music', label: 'Music' },
  { path: '/sound', label: 'Sound' },
  { path: '/image', label: 'Image' },
  { path: '/fashion', label: 'Fashion' },
  { path: '/engineering', label: 'Engineering' },
  { path: '/ceo', label: 'CEO' },
];

export default function Layout() {
  const location = useLocation();
  const { online, providerCount, loading } = useStudio();

  return (
    <div className="layout">
      <Navbar links={NAV_LINKS} mode="route" />

      <main className="main-content">
        <p className="layout-api-status" aria-live="polite">
          {loading ? 'Connecting…' : online ? `API · ${providerCount} providers` : 'API offline · port 3000'}
        </p>
        <div key={location.pathname} className="page-container fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
