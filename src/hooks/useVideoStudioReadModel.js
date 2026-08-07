import { useCallback, useEffect, useRef, useState } from 'react';
import { videoStudioReadApi } from '../lib/video-studio-read-api';

const EMPTY_DATA = Object.freeze({
  projects: [],
  assets: [],
  history: [],
  jobs: [],
  jobSummary: {},
  wallet: null,
  reservations: [],
  transactions: [],
});

export default function useVideoStudioReadModel({ pollMs = 10000 } = {}) {
  const [data, setData] = useState(EMPTY_DATA);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    const resources = [
      ['projects', videoStudioReadApi.projects],
      ['assets', videoStudioReadApi.assets],
      ['history', videoStudioReadApi.history],
      ['jobs', videoStudioReadApi.jobs],
      ['ledger', videoStudioReadApi.ledger],
    ];

    const results = await Promise.allSettled(
      resources.map(([, loader]) => loader()),
    );

    if (requestId !== requestIdRef.current) return;

    const payloads = {};
    const nextErrors = {};

    results.forEach((result, index) => {
      const [key] = resources[index];
      if (result.status === 'fulfilled') payloads[key] = result.value;
      else nextErrors[key] = result.reason?.message || `Could not load ${key}.`;
    });

    setData((current) => ({
      projects: payloads.projects?.projects ?? current.projects,
      assets: payloads.assets?.assets ?? current.assets,
      history: payloads.history?.history ?? current.history,
      jobs: payloads.jobs?.jobs ?? current.jobs,
      jobSummary: payloads.jobs?.summary ?? current.jobSummary,
      wallet: payloads.ledger?.wallet ?? current.wallet,
      reservations: payloads.ledger?.reservations ?? current.reservations,
      transactions: payloads.ledger?.transactions ?? current.transactions,
    }));
    setErrors(nextErrors);
    setLastUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    if (!pollMs) return undefined;
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);

  return {
    data,
    errors,
    loading,
    lastUpdatedAt,
    refresh,
  };
}
