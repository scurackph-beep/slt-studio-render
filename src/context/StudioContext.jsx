import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { refreshBackendState } from '../lib/api-client';
import { readStore, storageKeys } from '../lib/storage';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [providers, setProviders] = useState(() => readStore(storageKeys.providers, []));
  const [subscription, setSubscription] = useState(() => readStore(storageKeys.subscription, null));
  const [billing, setBilling] = useState(() => readStore(storageKeys.billing, null));
  const [bootError, setBootError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setBootError('');

    try {
      const state = await refreshBackendState();
      setOnline(state.online);
      setProviders(state.providers);
      setSubscription(state.subscription);
      setBilling(state.billing);

      if (!state.online) {
        setBootError('Backend offline — start api-proxy on port 3000.');
      }
    } catch {
      setOnline(false);
      setBootError('Could not reach backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading,
      online,
      providers,
      subscription,
      billing,
      bootError,
      refresh,
      providerCount: providers.length,
      credits: subscription?.credits ?? null,
      plan: subscription?.plan ?? 'Free',
      planStatus: subscription?.status ?? 'unknown',
    }),
    [loading, online, providers, subscription, billing, bootError, refresh],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used within StudioProvider');
  }
  return context;
}
