import { Outlet, Link, useLocation } from 'react-router-dom';

export default function Layout() {
  const location = useLocation();

  return (
    <div style={styles.appContainer}>
      {/* CASCADA HOLOGRÁFICA: Simulación digital de ruido/datos vivos de fondo */}
      <div style={styles.hologramMatrix}>
        <div style={styles.scanline}></div>
        <div style={styles.ambientGlow}></div>
      </div>

      {/* SIDEBAR MINIMALISTA: Navegación de control de holding */}
      <aside style={styles.sidebar}>
        <div style={styles.brandZone}>
          <span style={styles.logoText}>SWEET LITTLE TRAUMA</span>
          <span style={styles.studioTag}>// CREATIVE OS</span>
        </div>

        <nav style={styles.navigation}>
          <Link to="/video" style={{...styles.navItem, ...(location.pathname === '/video' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>🎬</span> VIDEO STUDIO
          </Link>
          <Link to="/music" style={{...styles.navItem, ...(location.pathname === '/music' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>🎵</span> MUSIC STUDIO
          </Link>
          <Link to="/sound" style={{...styles.navItem, ...(location.pathname === '/sound' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>🔊</span> SOUND STUDIO
          </Link>
          <Link to="/image" style={{...styles.navItem, ...(location.pathname === '/image' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>📸</span> IMAGE & APPAREL
          </Link>
          <Link to="/fashion" style={{...styles.navItem, ...(location.pathname === '/fashion' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>🧥</span> FASHION RUNWAY
          </Link>
          <Link to="/engineering" style={{...styles.navItem, ...(location.pathname === '/engineering' && styles.activeNavItem)}}>
            <span style={styles.navBullet}>💻</span> LAB ENG
          </Link>
        </nav>

        <div style={styles.footerStatus}>
          <div style={styles.statusRow}>
            <span style={styles.liveIndicator}>●</span>
            <span style={styles.statusText}>VOID_ASSIST_ACTIVE</span>
          </div>
          <div style={styles.creditBadge}>CREDITS: 1,500 VIP</div>
        </div>
      </aside>

      {/* LIENZO PRINCIPAL: El panel de vidrio ahumado donde corre cada aplicación */}
      <section style={styles.workspace}>
        <div style={styles.glassCorePanel}>
          <Outlet />
        </div>
      </section>
    </div>
  );
}

const styles = {
  appContainer: { display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#020202', color: '#ffffff', overflow: 'hidden', fontFamily: '"Courier New", Courier, monospace', position: 'relative' },
  hologramMatrix: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, background: 'linear-gradient(180deg, #050505 0%, #000000 100%)', overflow: 'hidden' },
  scanline: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03))', backgroundSize: '100% 4px, 6px 100%', opacity: 0.4 },
  ambientGlow: { position: 'absolute', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(255,255,255,0.015) 0%, rgba(0,0,0,0) 70%)', top: '-10%', right: '-10%', pointerEvents: 'none' },
  sidebar: { width: '260px', borderRight: '1px solid rgba(255, 255, 255, 0.03)', display: 'flex', flexDirection: 'column', padding: '2.5rem 1.5rem', zIndex: 2, background: 'rgba(5, 5, 5, 0.4)', backdropFilter: 'blur(30px)' },
  brandZone: { display: 'flex', flexDirection: 'column', marginBottom: '3.5rem' },
  logoText: { fontSize: '0.95rem', fontWeight: 'bold', letterSpacing: '2px', color: '#fff' },
  studioTag: { fontSize: '0.65rem', color: '#444', marginTop: '0.3rem', letterSpacing: '1px' },
  navigation: { display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 },
  navItem: { display: 'flex', alignItems: 'center', color: '#666', textDecoration: 'none', fontSize: '0.8rem', padding: '0.8rem 1rem', borderRadius: '4px', border: '1px solid transparent', letterSpacing: '1px', transition: 'all 0.3s ease' },
  activeNavItem: { color: '#fff', backgroundColor: 'rgba(255, 255, 255, 0.03)', borderColor: 'rgba(255, 255, 255, 0.08)', boxShadow: '0 0 15px rgba(255,255,255,0.01)' },
  navBullet: { marginRight: '0.8rem', fontSize: '0.9rem' },
  footerStatus: { display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid rgba(255, 255, 255, 0.03)', paddingTop: '1.5rem' },
  statusRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  liveIndicator: { color: '#00ff00', fontSize: '0.6rem', animation: 'pulse 2s infinite' },
  statusText: { fontSize: '0.65rem', color: '#555', letterSpacing: '1px' },
  creditBadge: { fontSize: '0.7rem', color: '#aaa', backgroundColor: 'rgba(255,255,255,0.02)', padding: '0.4rem 0.6rem', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.04)', width: 'fit-content' },
  workspace: { flexGrow: 1, padding: '2rem', zIndex: 1, display: 'flex', position: 'relative' },
  glassCorePanel: { flexGrow: 1, backgroundColor: 'rgba(8, 8, 8, 0.65)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.04)', borderRadius: '6px', boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)', overflow: 'hidden', display: 'flex' }
};
