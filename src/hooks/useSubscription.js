import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';

export function useSubscription() {
  const { isCEO, isAuthenticated } = useAuth();
  const { credits, planStatus, refreshLedger } = useStudio();
  const [loading, setLoading] = useState(true);
  const [hasCreditsState, setHasCreditsState] = useState(true);
  const [subscriptionActiveState, setSubscriptionActiveState] = useState(true);

  const refreshStatus = useCallback(async () => {
    if (isCEO) {
      setHasCreditsState(true);
      setSubscriptionActiveState(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const statusRes = await apiRequest('/api/subscription-status');
      if (statusRes.ok && statusRes.data) {
        setHasCreditsState(statusRes.data.hasCredits !== false);
        setSubscriptionActiveState(statusRes.data.subscriptionActive !== false);
      } else {
        const billingRes = await apiRequest('/api/billing');
        if (billingRes.ok && billingRes.data) {
          const walletCredits = billingRes.data.billing?.credits ?? billingRes.data.credits;
          if (walletCredits !== undefined) {
            setHasCreditsState(Number(walletCredits) > 0);
          }
        }

        const subRes = await apiRequest('/api/subscription');
        if (subRes.ok && subRes.data) {
          const sub = subRes.data.subscription ?? subRes.data;
          setSubscriptionActiveState(sub?.status === 'active' || sub?.active === true || sub?.status === 'trialing');
        }
      }

      await refreshLedger().catch(() => null);
    } catch (error) {
      console.error('Subscription check error:', error);
      setHasCreditsState(typeof credits === 'number' ? credits > 0 : true);
      setSubscriptionActiveState(planStatus === 'active' || planStatus === 'trialing');
    } finally {
      setLoading(false);
    }
  }, [isCEO, credits, planStatus, refreshLedger]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, isAuthenticated]);

  const hasCredits = isCEO || hasCreditsState || (typeof credits === 'number' && credits > 0);
  const subscriptionActive = isCEO || subscriptionActiveState || planStatus === 'active' || planStatus === 'trialing';

  return {
    hasCredits,
    subscriptionActive,
    isCEO,
    loading: isCEO ? false : loading,
    refreshStatus,
  };
}
