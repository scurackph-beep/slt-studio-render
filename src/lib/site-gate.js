export const SITE_GATE_STORAGE_KEY = 'slt-site-gate-unlocked-v2';

// Sin VITE_SITE_GATE_KEY no hay cortina. Nunca una clave por defecto en el
// código: todo lo que empieza con VITE_ termina dentro del bundle público.
export const SITE_GATE_KEY = import.meta.env.VITE_SITE_GATE_KEY || '';

export function isSiteGateEnabled() {
  return SITE_GATE_KEY !== '';
}

export function isSiteGateUnlocked() {
  if (!isSiteGateEnabled()) return true;
  try {
    return sessionStorage.getItem(SITE_GATE_STORAGE_KEY) === SITE_GATE_KEY;
  } catch {
    return false;
  }
}

export function unlockSiteGateFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return unlockSiteGate(params.get('site_gate') || '');
  } catch {
    return false;
  }
}

export function unlockSiteGate(password = '') {
  if (!isSiteGateEnabled()) return true;
  const normalized = String(password || '').trim();
  if (normalized !== SITE_GATE_KEY) return false;
  sessionStorage.setItem(SITE_GATE_STORAGE_KEY, SITE_GATE_KEY);
  return true;
}

export function lockSiteGate() {
  sessionStorage.removeItem(SITE_GATE_STORAGE_KEY);
}

export function siteGateHeaderValue() {
  return isSiteGateUnlocked() ? SITE_GATE_KEY : '';
}
