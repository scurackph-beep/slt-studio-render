import { useEffect, useState } from 'react';
import {
  extractAsyncJob,
  extractOutputUrl,
  fetchLedger,
  generateStudio,
  pollJob,
  readableStudioMessage,
} from '../lib/api-client';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import { canUseGuestQuota, consumeGuestQuota, quotaKindFor } from '../lib/access-control';
import { useStudio } from '../context/StudioContext';
import { useAuth } from '../context/AuthContext';

const QUEUE_LIMIT = 16;
const TERMINAL_QUEUE_STATES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'canceled']);

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

function asyncStatusMessage({ kind, provider, status }) {
  const readableStatus = String(status || 'processing').replace(/_/g, ' ');
  const phase = readableStatus === 'queued' ? 'In queue' : readableStatus === 'completed' ? 'Completed' : 'Generating';
  const label = kind === 'video' ? 'Render' : 'Generation';
  return label + ' ' + phase.toLowerCase() + (provider ? ' on ' + provider : '') + '.';
}

function clampOutputCount(value) {
  const parsed = Number.parseInt(String(value || '1'), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(8, Math.max(1, parsed));
}

function queueItemId() {
  return 'queue_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function outputLabel({ kind, title, batchIndex, batchTotal }) {
  const base = title || kind + ' generation';
  return batchTotal > 1 ? base + ' · ' + batchIndex + '/' + batchTotal : base;
}

export function useStudioGenerate(kind) {
  const { refreshLedger } = useStudio();
  const { session, isGuest, isSpy } = useAuth();
  const [assetUrl, setAssetUrl] = useState('');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('idle');
  const [ledger, setLedger] = useState(null);
  const [status, setStatus] = useState('');
  const [queueItems, setQueueItems] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const hasActiveQueue = queueItems.some((item) => !TERMINAL_QUEUE_STATES.has(String(item.status || '').toLowerCase()));
    if (!hasActiveQueue) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [queueItems]);

  const updateQueueItem = (id, patch) => {
    setQueueItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
    )));
  };

  const pushQueueItem = (item) => {
    setQueueItems((current) => [...current, item].slice(-QUEUE_LIMIT));
  };

  const executeSingleGenerate = async ({ title, prompt, provider, providerLabel, tool, ...payload }, batchMeta = { index: 1, total: 1 }) => {
    const quotaKind = quotaKindFor(kind, payload);
    if (isSpy) {
      const message = 'Spy mode is read-only. Create an account, log in, use CEO mode or enter a guest code to generate.';
      setJobStatus('blocked');
      setStatus(message);
      setError(message);
      return { ok: false, status: 403, message };
    }
    if (isGuest && !canUseGuestQuota(quotaKind, session)) {
      const message = 'Guest quota reached for ' + quotaKind + '. This guest pass allows 2 ' + quotaKind + ' requests.';
      setJobStatus('blocked');
      setStatus(message);
      setError(message);
      return { ok: false, status: 402, message };
    }

    const itemId = queueItemId();
    const startedAt = Date.now();
    const label = outputLabel({ kind, title, batchIndex: batchMeta.index, batchTotal: batchMeta.total });
    pushQueueItem({
      id: itemId,
      label,
      provider: providerLabel || provider,
      status: 'submitting',
      message: kind === 'video' ? 'Sending render to provider...' : 'Sending request...',
      startedAt,
      updatedAt: startedAt,
      outputUrl: '',
      error: '',
    });

    setJobId('');
    setJobStatus('submitting');
    setStatus(kind === 'video' ? 'Sending render to provider...' : 'Sending request...');

    const requestPayload = {
      ...payload,
      outputCount: 1,
      count: 1,
      quantity: 1,
    };

    try {
      const result = await generateStudio({
        kind,
        title,
        prompt,
        provider,
        providerLabel,
        tool,
        ...requestPayload,
      });

      if (!result.ok) {
        const message = readableStudioMessage(result.message || result.data?.readableError || result.data?.error);
        setError(message);
        setJobStatus(result.status === 400 ? 'blocked' : 'failed');
        setStatus(message);
        updateQueueItem(itemId, {
          status: result.status === 400 ? 'blocked' : 'failed',
          message,
          error: message,
          endedAt: Date.now(),
        });
        return result;
      }

      persistGeneration(result);
      if (isGuest) consumeGuestQuota(quotaKind, session);

      const immediateUrl = extractOutputUrl(result);
      if (immediateUrl) {
        setAssetUrl(immediateUrl);
        updateQueueItem(itemId, {
          status: 'completed',
          message: 'Generation complete.',
          outputUrl: immediateUrl,
          endedAt: Date.now(),
        });
      }

      const { jobId: asyncJobId, provider: jobProvider, needsPoll, status: initialJobStatus } = extractAsyncJob(result);

      if (needsPoll && asyncJobId) {
        const activeProvider = jobProvider || provider;
        setJobId(asyncJobId);
        setJobStatus(initialJobStatus || 'queued');
        setStatus('Queued on ' + (activeProvider || 'provider') + '. Timer running.');
        updateQueueItem(itemId, {
          jobId: asyncJobId,
          provider: activeProvider,
          status: initialJobStatus || 'queued',
          message: 'Queued on ' + (activeProvider || 'provider') + '.',
        });

        const pollResult = await pollJob(asyncJobId, activeProvider, {
          intervalMs: payload.pollIntervalMs || 3000,
          maxAttempts: payload.maxPollAttempts || 80,
          onTick: ({ status: polledStatus, attempt, maxAttempts }) => {
            const nextStatus = polledStatus || 'processing';
            const message = asyncStatusMessage({ kind, provider: activeProvider, status: nextStatus });
            setJobStatus(nextStatus);
            setStatus(message);
            updateQueueItem(itemId, {
              status: nextStatus,
              message,
              attempt: attempt + 1,
              maxAttempts,
            });
          },
        });

        const ledgerResult = await persistLedgerSnapshot();
        await refreshLedger().catch(() => null);
        if (ledgerResult.ok) setLedger(ledgerResult.data?.wallet || null);

        if (pollResult.ok && pollResult.completed) {
          persistGeneration(pollResult);
          const completedUrl = extractOutputUrl(pollResult);
          if (completedUrl) setAssetUrl(completedUrl);
          const message = pollResult.data?.message || 'Generation complete.';
          setJobStatus('completed');
          setStatus(message);
          updateQueueItem(itemId, {
            status: 'completed',
            message,
            outputUrl: completedUrl || '',
            endedAt: Date.now(),
          });
          return pollResult;
        }

        const message = pollResult.message === 'Job timed out while processing.'
          ? 'Render is still processing. Check history again in a few minutes.'
          : readableStudioMessage(pollResult.message || pollResult.data?.message || pollResult.data?.readableError);
        setError(message);
        setJobStatus(pollResult.message === 'Job timed out while processing.' ? 'processing' : 'failed');
        setStatus(message);
        updateQueueItem(itemId, {
          status: pollResult.message === 'Job timed out while processing.' ? 'processing' : 'failed',
          message,
          error: pollResult.message === 'Job timed out while processing.' ? '' : message,
          endedAt: pollResult.message === 'Job timed out while processing.' ? null : Date.now(),
        });
        return pollResult;
      }

      const ledgerResult = await persistLedgerSnapshot();
      await refreshLedger().catch(() => null);
      if (ledgerResult.ok) setLedger(ledgerResult.data?.wallet || null);
      const message = result.data?.success || result.data?.message || 'Generation complete.';
      setJobStatus('completed');
      setStatus(message);
      if (!immediateUrl) {
        updateQueueItem(itemId, {
          status: 'completed',
          message,
          endedAt: Date.now(),
        });
      }
      return result;
    } catch (caught) {
      const message = readableStudioMessage(caught.message);
      setError(message);
      setJobStatus('failed');
      setStatus(message);
      updateQueueItem(itemId, {
        status: 'failed',
        message,
        error: message,
        endedAt: Date.now(),
      });
      return { ok: false, error: caught, message };
    }
  };

  const runGenerate = async (request) => {
    const requestedOutputCount = clampOutputCount(request.outputCount || request.count || request.quantity || 1);
    setAssetUrl('');
    setError('');
    setQueueItems([]);
    setGenerating(true);

    try {
      if (requestedOutputCount > 1) {
        setJobStatus('queued');
        setStatus('Queued ' + requestedOutputCount + ' outputs.');
        const results = [];
        for (let index = 1; index <= requestedOutputCount; index += 1) {
          const result = await executeSingleGenerate(
            { ...request, outputCount: 1, count: 1, quantity: 1 },
            { index, total: requestedOutputCount },
          );
          results.push(result);
        }
        const successful = results.filter((result) => result.ok).length;
        return {
          ok: successful > 0,
          online: true,
          data: { batch: results, successful, requestedOutputCount },
          message: successful === requestedOutputCount
            ? successful + ' outputs completed.'
            : successful + '/' + requestedOutputCount + ' outputs completed.',
        };
      }

      return await executeSingleGenerate(request, { index: 1, total: 1 });
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
    now,
    queueItems,
    status,
    setStatus,
    runGenerate,
  };
}
