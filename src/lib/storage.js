export const storageKeys = {
  projects: 'slt-projects',
  history: 'slt-history',
  session: 'slt-session',
  user: 'slt-user-profile',
  billing: 'slt-billing',
  subscription: 'slt-subscription',
  providers: 'slt-provider-status',
  uploads: 'slt-uploaded-references',
};

export function readStore(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getSession() {
  return readStore(storageKeys.session, null);
}
