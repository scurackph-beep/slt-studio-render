import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getSession, readStore, storageKeys, writeStore } from '../lib/storage';

const AuthContext = createContext(null);

function clearStoredAuth() {
  localStorage.removeItem('sessionToken');
  localStorage.removeItem(storageKeys.session);
  localStorage.removeItem(storageKeys.user);
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => readStore(storageKeys.user, null));
  const [session, setSessionState] = useState(() => getSession());

  const setUser = useCallback((next) => {
    setUserState(next);
    if (next) writeStore(storageKeys.user, next);
    else localStorage.removeItem(storageKeys.user);
  }, []);

  const setSession = useCallback((next) => {
    setSessionState(next);
    if (next?.token) {
      writeStore(storageKeys.session, next);
      localStorage.setItem('sessionToken', next.token);
    } else {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem(storageKeys.session);
    }
  }, []);

  const logout = useCallback(() => {
    setUserState(null);
    setSessionState(null);
    clearStoredAuth();
  }, []);

  const value = useMemo(() => {
    const isCEO = session?.role === 'CEO' || user?.role === 'CEO';
    const isGuest = session?.role === 'GUEST' || user?.role === 'GUEST' || session?.mode === 'INVITED_GUEST';
    const isSpy = session?.role === 'SPY' || user?.role === 'SPY' || session?.mode === 'SPY_READ_ONLY';
    const isAuthenticated = Boolean(session?.token);

    return {
      user,
      session,
      setUser,
      setSession,
      logout,
      isCEO,
      isGuest,
      isSpy,
      isAuthenticated,
    };
  }, [user, session, setUser, setSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
