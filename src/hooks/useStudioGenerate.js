import { useState } from 'react';
import {
  extractAsyncJob,
  extractOutputUrl,
  fetchLedger,
  generateStudio,
  pollJob,
  readableStudioMessage,
} from '../lib/api-client';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import { useStudio } from '../context/StudioContext';

function persistGeneration(result) {
  const entry = result.data?.historyItem || result.data?.project;
  if (entry) {
    const history = readStore(storageKeys.history, []);
    writeStore(storageKeys.history, [entry, ...history].slice(0, 40));
  }
  if (result.data?.subscription) {
    writeStore(storageKeys.subscription, result.data.subscription);
  }
}

async function persistLedgerSnapshot() {
  const result = await fetchLedger();
  const wallet = result.data?.wallet;

  if (result.ok && wallet) {
    const currentSubscription = readStore(storageKeys.subscription, {}) || {};
    const currentUser = readStore(storageKeys.user, {}) || {};
    const credits = wallet.availableCredits;
    const ledgerState = {
      credits,
      availableCredits: wallet.availableCredits,
      heldCredits: wallet.heldCredits,
      capturedCredits: wallet.capturedCredits,
      transactionCount: wallet.transactionCount,
      reservationCount: wallet.reservationCount,
    };

    writeStore(storageKeys.subscription, { ...currentSubscription, ...ledgerState });
    writeStore(storageKeys.user, { ...currentUser, credits, ledger: wallet });
  }

  return result;
}

function asyncStatusMessage({ kind, provider, status, attempt, maxAttempts }) {
  const readableStatus = String(status || 'processing').replace(/_/g, ' ');
  const phase = readableStatus === 'queued' ? 'In queue' : readableStatus === 'completed' ? 'Completed' : 'Generating';
  const suffix = typeof attempt === 'number' ? ` ${attempt + 1}/${maxAttempts}` : '';
  const label = kind === 'video' ? 'Render' : 'Generation';
  return `${label} ${phase.toLowerCase()}${provider ? ` on ${provider}` : ''}.${suffix}`;
}

export function useStudioGenerate(kind) {
  const { refreshLedger } = useStudio();
  const [assetUrl, setAssetUrl] = useState('');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('idle');
  const [ledger, setLedger] = useState(null);
  const [status, setStatus] = useState('');

  const runGenerate = async ({ title, prompt, provider, providerLabel, tool, ...payload }) => {
    setAssetUrl('');
    setError('');
    setGenerating(true);
    setJobId('');
    setJobStatus('submitting');
    setStatus(kind === 'video' ? 'Sending render to provider...' : 'Sending request...');

    try {
      const result = await generateStudio({
        kind,
        title,
        prompt,
        provider,
        providerLabel,
        tool,
        ...payload,
      });

      if (!result.ok) {
        const message = readableStudioMessage(result.message || result.data?.readableError || result.data?.error);
        setError(message);
        setJobStatus(result.status === 400 ? 'blocked' : 'failed');
        setStatus(message);
        return result;
      }

      persistGeneration(result);

      const immediateUrl = extractOutputUrl(result);
      if (immediateUrl) setAssetUrl(immediateUrl);

      const { jobId: asyncJobId, provider: jobProvider, needsPoll, status: initialJobStatus } = extractAsyncJob(result);

      if (needsPoll && asyncJobId) {
        const activeProvider = jobProvider || provider;
        setJobId(asyncJobId);
        setJobStatus(initialJobStatus || 'queued');
        setStatus(`Queued on ${activeProvider || 'provider'}. Job ${String(asyncJobId).slice(0, 12)}...`);

        const pollResult = await pollJob(asyncJobId, activeProvider, {
          intervalMs: payload.pollIntervalMs || 5000,
          maxAttempts: payload.maxPollAttempts || 36,
          onTick: ({ attempt, maxAttempts, status: polledStatus }) => {
            setJobStatus(polledStatus || 'processing');
            setStatus(asyncStatusMessage({
              kind,
              provider: activeProvider,
              status: polledStatus,
              attempt,
              maxAttempts,
            }));
          },
        });

        const ledgerResult = await persistLedgerSnapshot();
        await refreshLedger().catch(() => null);
        if (ledgerResult.ok) setLedger(ledgerResult.data?.wallet || null);

        if (pollResult.ok && pollResult.completed) {
          persistGeneration(pollResult);
          const completedUrl = extractOutputUrl(pollResult);
          if (completedUrl) setAssetUrl(completedUrl);
          setJobStatus('completed');
          setStatus(pollResult.data?.message || 'Generation complete.');
          return pollResult;
        }

        const message = pollResult.message === 'Job timed out while processing.'
          ? 'Render is still processing. Check history again in a few minutes.'
          : readableStudioMessage(pollResult.message || pollResult.data?.message || pollResult.data?.readableError);
        setError(message);
        setJobStatus('failed');
        setStatus(message);
        return pollResult;
      }

      const ledgerResult = await persistLedgerSnapshot();
      await refreshLedger().catch(() => null);
      if (ledgerResult.ok) setLedger(ledgerResult.data?.wallet || null);
      setJobStatus('completed');
      setStatus(result.data?.success || result.data?.message || 'Generation complete.');
      return result;
    } catch (caught) {
      const message = readableStudioMessage(caught.message);
      setError(message);
      setJobStatus('failed');
      setStatus(message);
      return { ok: false, error: caught, message };
    } finally {
      setGenerating(false);
    }
  };

  return {
    assetUrl,
    error,
    generating,
    jobId,
    jobStatus,
    ledger,
    status,
    setStatus,
    runGenerate,
  };
}
