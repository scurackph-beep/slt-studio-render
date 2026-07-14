export const SITE_GATE_STORAGE_KEY = 'slt-site-gate-unlocked';
export const SITE_GATE_KEY = import.meta.env.VITE_SITE_GATE_KEY || 'Dientito2032';

export function isSiteGateUnlocked() {
  try {
    return sessionStorage.getItem(SITE_GATE_STORAGE_KEY) === SITE_GATE_KEY;
  } catch {
    return false;
  }
}

export function unlockSiteGate(password = '') {
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
