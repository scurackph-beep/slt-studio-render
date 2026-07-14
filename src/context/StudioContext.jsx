import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchLedger, refreshBackendState } from '../lib/api-client';
import { readStore, storageKeys, writeStore } from '../lib/storage';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [providers, setProviders] = useState(() => readStore(storageKeys.providers, []));
  const [subscription, setSubscription] = useState(() => readStore(storageKeys.subscription, null));
  const [billing, setBilling] = useState(() => readStore(storageKeys.billing, null));
  const [bootError, setBootError] = useState('');

  const refreshLedger = useCallback(async () => {
    const result = await fetchLedger();
    const wallet = result.data?.wallet;

    if (result.ok && wallet) {
      setSubscription((current) => {
        const next = {
          ...(current || readStore(storageKeys.subscription, {}) || {}),
          credits: wallet.availableCredits,
          availableCredits: wallet.availableCredits,
          heldCredits: wallet.heldCredits,
          capturedCredits: wallet.capturedCredits,
          transactionCount: wallet.transactionCount,
          reservationCount: wallet.reservationCount,
        };
        writeStore(storageKeys.subscription, next);
        return next;
      });
    }

    return result;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setBootError('');

    try {
      const state = await refreshBackendState();
      setOnline(state.online);
      setProviders(state.providers);
      setSubscription(state.subscription);
      setBilling(state.billing);
      await refreshLedger().catch(() => null);

      if (!state.online) {
        setBootError('Backend offline — start api-proxy on port 3000.');
      }
    } catch {
      setOnline(false);
      setBootError('Could not reach backend.');
    } finally {
      setLoading(false);
    }
  }, [refreshLedger]);

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
      refreshLedger,
      providerCount: providers.length,
      credits: subscription?.credits ?? subscription?.availableCredits ?? null,
      heldCredits: subscription?.heldCredits ?? 0,
      plan: subscription?.plan ?? 'Free',
      planStatus: subscription?.status ?? 'unknown',
    }),
    [loading, online, providers, subscription, billing, bootError, refresh, refreshLedger],
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
