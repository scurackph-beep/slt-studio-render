import { getSession, readStore, storageKeys, writeStore } from './storage';

export const GUEST_QUOTA_LIMITS = {
  video: 2,
  image: 2,
  sound: 2,
  music: 2,
  fashion: 2,
  engineering: 2,
};

export const accessStorageKeys = {
  guestUsage: 'slt-guest-usage',
};

export function isGuestSession(session = getSession()) {
  return session?.role === 'GUEST' || session?.mode === 'INVITED_GUEST';
}

export function isSpySession(session = getSession()) {
  return session?.role === 'SPY' || session?.mode === 'SPY_READ_ONLY';
}

export function quotaKindFor(kind = '', payload = {}) {
  if (payload?.module === 'fashion' || payload?.quotaKind === 'fashion') return 'fashion';
  if (payload?.module === 'engineering' || payload?.quotaKind === 'engineering') return 'engineering';
  return String(kind || '').toLowerCase();
}

function usageOwner(session = getSession()) {
  return session?.userId || session?.id || session?.username || session?.email || 'guest';
}

function readGuestUsage() {
  return readStore(accessStorageKeys.guestUsage, {});
}

function writeGuestUsage(value) {
  writeStore(accessStorageKeys.guestUsage, value);
}

export function guestUsageFor(session = getSession()) {
  const usage = readGuestUsage();
  return usage[usageOwner(session)] || {};
}

export function guestQuotaSnapshot(session = getSession()) {
  const usage = guestUsageFor(session);
  return Object.fromEntries(
    Object.entries(GUEST_QUOTA_LIMITS).map(([kind, limit]) => [
      kind,
      {
        used: Number(usage[kind] || 0),
        limit,
        remaining: Math.max(0, limit - Number(usage[kind] || 0)),
      },
    ]),
  );
}

export function canUseGuestQuota(kind, session = getSession(), requested = 1) {
  if (!isGuestSession(session)) return true;
  const quotaKind = quotaKindFor(kind);
  const usage = guestUsageFor(session);
  const limit = GUEST_QUOTA_LIMITS[quotaKind];
  if (!limit) return true;
  const count = Math.max(1, Number.parseInt(String(requested || 1), 10) || 1);
  return Number(usage[quotaKind] || 0) + count <= limit;
}

export function consumeGuestQuota(kind, session = getSession(), consumed = 1) {
  if (!isGuestSession(session)) return guestQuotaSnapshot(session);
  const quotaKind = quotaKindFor(kind);
  if (!GUEST_QUOTA_LIMITS[quotaKind]) return guestQuotaSnapshot(session);
  const count = Math.max(1, Number.parseInt(String(consumed || 1), 10) || 1);
  const allUsage = readGuestUsage();
  const owner = usageOwner(session);
  const current = allUsage[owner] || {};
  const next = {
    ...allUsage,
    [owner]: {
      ...current,
      [quotaKind]: Math.min(GUEST_QUOTA_LIMITS[quotaKind], Number(current[quotaKind] || 0) + count),
    },
  };
  writeGuestUsage(next);
  return guestQuotaSnapshot(session);
}

export function storeAccessSession({ session, user }) {
  if (session) {
    writeStore(storageKeys.session, session);
    if (session.token) localStorage.setItem('sessionToken', session.token);
    else localStorage.removeItem('sessionToken');
  }
  if (user) writeStore(storageKeys.user, user);
}
