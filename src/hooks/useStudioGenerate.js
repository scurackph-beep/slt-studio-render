import { useEffect, useState } from 'react';
import {
  extractAsyncJob,
  extractOutputUrl,
  fetchLedger,
  generateStudio,
  pollGenerationBatch,
  pollJob,
  readableStudioMessage,
  reportIncident,
  retryGenerationJob,
} from '../lib/api-client';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import { canUseGuestQuota, consumeGuestQuota, quotaKindFor } from '../lib/access-control';
import { useStudio } from '../context/StudioContext';
import { useAuth } from '../context/AuthContext';

const QUEUE_LIMIT = 16;
const TERMINAL_QUEUE_STATES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'canceled']);

function persistGeneration(result) {
  const entries = [
    ...(Array.isArray(result.data?.historyItems) ? result.data.historyItems : []),
    result.data?.historyItem,
    result.data?.project,
  ].filter(Boolean);
  if (entries.length) {
    const history = readStore(storageKeys.history, []);
    const seen = new Set();
    writeStore(storageKeys.history, [...entries, ...history].filter((entry) => {
      const key = entry.id || JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40));
  }
  if (result.data?.subscription) writeStore(storageKeys.subscription, result.data.subscription);
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

function clampOutputCount(value) {
  const parsed = Number.parseInt(String(value || '1'), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(8, Math.max(1, parsed));
}

function queueItemId() {
  return 'queue_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function queueStatusMessage(kind, job = {}) {
  const status = String(job.status || 'processing').toLowerCase();
  if (status === 'pending' || status === 'queued') return 'In queue.';
  if (status === 'throttled') return 'Waiting for provider capacity.';
  if (status === 'completed') return kind === 'video' ? 'Render complete.' : 'Generation complete.';
  if (status === 'failed') return job.error?.message || job.error || 'Generation failed.';
  if (status === 'cancelled' || status === 'canceled') return 'Generation cancelled.';
  return kind === 'video' ? 'Rendering.' : 'Generating.';
}

function queueItemFromJob(job, { kind, title, provider, startedAt, total }) {
  const status = String(job.status || 'pending').toLowerCase();
  const index = Number(job.batchIndex || 1);
  return {
    id: job.id || queueItemId(),
    jobId: job.id || job.jobId || '',
    batchId: job.batchId || null,
    batchIndex: index,
    batchTotal: total,
    label: total > 1 ? `${title || kind + ' generation'} · ${index}/${total}` : (title || kind + ' generation'),
    provider: job.provider || provider || '',
    status,
    progress: Number(job.progress || 0),
    message: queueStatusMessage(kind, job),
    startedAt,
    updatedAt: Date.now(),
    endedAt: TERMINAL_QUEUE_STATES.has(status) ? Date.now() : null,
    outputUrl: job.outputUrl || job.outputUrls?.[0] || '',
    assetId: job.assetId || null,
    error: status === 'failed' ? (job.error?.message || job.error || 'Generation failed.') : '',
  };
}

function incidentFromPayload(payload = {}, fallback = {}) {
  const data = payload?.data || payload || {};
  const job = data.job || fallback.job || {};
  const jobError = job.error && typeof job.error === 'object' ? job.error : {};
  const source = data.incident || jobError.incident || jobError || {};
  const incidentId = source.incidentId || data.incidentId || job.incidentId || null;
  const errorCode = source.errorCode || data.errorCode || null;
  if (!incidentId && !errorCode) return null;
  return {
    incidentId,
    errorCode,
    errorName: source.errorName || data.code || jobError.code || null,
    category: source.category || null,
    customerMessage: source.customerMessage || data.customerMessage || data.readableError || data.error || jobError.customerMessage || jobError.message || fallback.message || 'Generation failed.',
    retryable: Boolean(source.retryable ?? data.retryable ?? jobError.retryable),
    reservationReleased: Boolean(source.reservationReleased ?? data.reservationReleased ?? jobError.reservationReleased),
    reported: Boolean(source.reported),
    status: source.status || 'OPEN',
    compensation: data.compensation || jobError.compensation || source.compensation || null,
    jobId: source.jobId || data.jobId || job.id || fallback.jobId || null,
    batchId: source.batchId || data.batchId || job.batchId || fallback.batchId || null,
    provider: source.provider || job.provider || fallback.provider || null,
    model: source.model || job.parameters?.model || fallback.model || null,
  };
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
  const [incident, setIncident] = useState(null);
  const [incidentAction, setIncidentAction] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [status, setStatus] = useState('');
  const [queueItems, setQueueItems] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const active = queueItems.some((item) => !TERMINAL_QUEUE_STATES.has(String(item.status || '').toLowerCase()));
    if (!active) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [queueItems]);

  const finishLedger = async () => {
    const ledgerResult = await persistLedgerSnapshot();
    await refreshLedger().catch(() => null);
    if (ledgerResult.ok) setLedger(ledgerResult.data?.wallet || null);
  };

  const runGenerate = async (request) => {
    const outputCount = clampOutputCount(request.outputCount || request.count || request.quantity || 1);
    const quotaKind = quotaKindFor(kind, request);
    setAssetUrl('');
    setError('');
    setIncident(null);
    setIncidentAction('');
    setQueueItems([]);

    if (isSpy) {
      const message = 'Spy mode is read-only. Create an account, log in, use CEO mode or enter a guest code to generate.';
      setJobStatus('blocked');
      setStatus(message);
      setError(message);
      return { ok: false, status: 403, message };
    }
    if (isGuest && !canUseGuestQuota(quotaKind, session, outputCount)) {
      const message = `This guest pass does not have ${outputCount} ${quotaKind} outputs remaining.`;
      setJobStatus('blocked');
      setStatus(message);
      setError(message);
      return { ok: false, status: 402, message };
    }

    const startedAt = Date.now();
    setGenerating(true);
    setJobStatus('submitting');
    setStatus(`Submitting ${outputCount} ${kind} output${outputCount === 1 ? '' : 's'}...`);
    setQueueItems(Array.from({ length: outputCount }, (_, index) => ({
      id: queueItemId(),
      label: outputCount > 1 ? `${request.title || kind + ' generation'} · ${index + 1}/${outputCount}` : (request.title || kind + ' generation'),
      provider: request.providerLabel || request.provider || '',
      status: 'submitting',
      progress: 0,
      message: 'Submitting request.',
      startedAt,
      updatedAt: startedAt,
      outputUrl: '',
      error: '',
    })));

    try {
      const result = await generateStudio({
        ...request,
        kind,
        outputCount,
        count: outputCount,
        quantity: outputCount,
      });
      if (!result.ok) {
        const message = readableStudioMessage(result.message || result.data?.readableError || result.data?.error);
        const failedStatus = result.status === 400 ? 'blocked' : 'failed';
        setIncident(incidentFromPayload(result, { message, provider: request.provider, model: request.model }));
        setError(message);
        setJobStatus(failedStatus);
        setStatus(message);
        setQueueItems((items) => items.map((item) => ({ ...item, status: failedStatus, message, error: message, endedAt: Date.now() })));
        return result;
      }

      persistGeneration(result);
      if (isGuest) consumeGuestQuota(quotaKind, session, outputCount);

      const responseJobs = result.data?.batch?.jobs || result.data?.jobs || [];
      const batchId = result.data?.batchId || result.data?.batch?.id || null;
      if (responseJobs.length) {
        const mapped = responseJobs.map((job) => queueItemFromJob(job, {
          kind,
          title: request.title,
          provider: request.providerLabel || request.provider,
          startedAt,
          total: responseJobs.length,
        }));
        setQueueItems(mapped.slice(-QUEUE_LIMIT));
        setJobId(mapped[0]?.jobId || '');
        setJobStatus(mapped.some((item) => item.status === 'throttled') ? 'throttled' : 'pending');
      }

      if (batchId) {
        setStatus(`Batch ${batchId} accepted. Timer running.`);
        const pollResult = await pollGenerationBatch(batchId, {
          intervalMs: request.pollIntervalMs || 3000,
          maxAttempts: request.maxPollAttempts || 80,
          onTick: ({ batch, jobs }) => {
            const nextItems = jobs.map((job) => queueItemFromJob(job, {
              kind,
              title: request.title,
              provider: request.providerLabel || request.provider,
              startedAt,
              total: jobs.length,
            }));
            setQueueItems(nextItems.slice(-QUEUE_LIMIT));
            const active = nextItems.find((item) => !TERMINAL_QUEUE_STATES.has(item.status));
            setJobStatus(active?.status || String(batch.status || 'processing').toLowerCase());
            setStatus(active ? queueStatusMessage(kind, active) : `${batch.completedOutputs || 0}/${batch.requestedOutputs || jobs.length} completed.`);
            const firstCompleted = nextItems.find((item) => item.outputUrl);
            if (firstCompleted?.outputUrl) setAssetUrl(firstCompleted.outputUrl);
          },
        });
        await finishLedger();

        if (pollResult.ok && pollResult.completed) {
          const batch = pollResult.data?.batch || {};
          const firstOutput = batch.jobs?.find((item) => item.outputUrl)?.outputUrl || '';
          if (firstOutput) setAssetUrl(firstOutput);
          setJobStatus(batch.partial ? 'completed' : String(batch.status || 'completed').toLowerCase());
          setStatus(batch.partial
            ? `${batch.completedOutputs}/${batch.requestedOutputs} outputs completed; failed reservations were released.`
            : `${batch.completedOutputs || batch.jobs?.length || outputCount} outputs completed.`);
          return pollResult;
        }

        const message = pollResult.timedOut
          ? 'The batch is still processing. It remains visible in the queue and history.'
          : readableStudioMessage(pollResult.message || pollResult.data?.message || 'Generation batch failed.');
        if (!pollResult.timedOut) {
          const failedJob = pollResult.data?.batch?.jobs?.find((item) => ['failed', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase()));
          setIncident(incidentFromPayload({ ...pollResult.data, job: failedJob }, { message, batchId, provider: request.provider, model: request.model }));
        }
        setError(pollResult.timedOut ? '' : message);
        setJobStatus(pollResult.timedOut ? 'processing' : 'failed');
        setStatus(message);
        return pollResult;
      }

      const immediateUrl = extractOutputUrl(result);
      if (immediateUrl) setAssetUrl(immediateUrl);
      const { jobId: asyncJobId, provider, needsPoll, status: initialStatus } = extractAsyncJob(result);
      if (needsPoll && asyncJobId) {
        setJobId(asyncJobId);
        const pollResult = await pollJob(asyncJobId, provider || request.provider, {
          intervalMs: request.pollIntervalMs || 3000,
          maxAttempts: request.maxPollAttempts || 80,
          onTick: ({ status: nextStatus }) => {
            setJobStatus(nextStatus || 'processing');
            setQueueItems((items) => items.map((item) => ({ ...item, status: nextStatus || 'processing', message: queueStatusMessage(kind, { status: nextStatus }) })));
          },
        });
        await finishLedger();
        if (pollResult.ok && pollResult.completed) {
          const output = extractOutputUrl(pollResult);
          if (output) setAssetUrl(output);
          setJobStatus('completed');
          setStatus('Generation complete.');
          setQueueItems((items) => items.map((item) => ({ ...item, status: 'completed', outputUrl: output || '', endedAt: Date.now() })));
        } else if (!pollResult.timedOut) {
          const message = readableStudioMessage(pollResult.message || pollResult.data?.job?.error?.message || 'Generation failed.');
          setIncident(incidentFromPayload(pollResult, { message, jobId: asyncJobId, provider: provider || request.provider, model: request.model }));
          setError(message);
          setJobStatus('failed');
          setStatus(message);
        }
        return pollResult;
      }

      await finishLedger();
      setJobStatus(initialStatus || 'completed');
      setStatus(result.data?.success || result.data?.message || 'Generation complete.');
      setQueueItems((items) => items.map((item) => ({ ...item, status: 'completed', outputUrl: immediateUrl || '', endedAt: Date.now() })));
      return result;
    } catch (caught) {
      const message = readableStudioMessage(caught.message);
      setError(message);
      setJobStatus('failed');
      setStatus(message);
      setQueueItems((items) => items.map((item) => ({ ...item, status: 'failed', message, error: message, endedAt: Date.now() })));
      return { ok: false, error: caught, message };
    } finally {
      setGenerating(false);
    }
  };

  const sendIncidentReport = async (note = '') => {
    if (!incident?.incidentId) return { ok: false, message: 'No incident is available to report.' };
    setIncidentAction('Sending report...');
    const result = await reportIncident(incident.incidentId, {
      route: typeof window === 'undefined' ? '' : window.location.pathname + window.location.search,
      note,
    });
    if (result.ok) {
      setIncident((current) => current ? { ...current, ...result.data?.incident, reported: true } : current);
      setIncidentAction(result.data?.message || 'Report sent successfully.');
    } else setIncidentAction(result.message || 'The report could not be sent.');
    return result;
  };

  const retryLastGeneration = async () => {
    if (!incident?.jobId || !incident.retryable) return { ok: false, message: 'This generation cannot be retried.' };
    const startedAt = Date.now();
    setRetrying(true);
    setGenerating(true);
    setError('');
    setIncidentAction('Creating a new Job...');
    setJobStatus('submitting');
    try {
      const result = await retryGenerationJob(incident.jobId);
      if (!result.ok) {
        const message = readableStudioMessage(result.message || result.data?.readableError || result.data?.error);
        setError(message);
        setStatus(message);
        setJobStatus('failed');
        setIncident(incidentFromPayload(result, { message, jobId: incident.jobId }) || incident);
        return result;
      }

      const responseJobs = result.data?.batch?.jobs || result.data?.jobs || (result.data?.job ? [result.data.job] : []);
      const batchId = result.data?.batchId || result.data?.batch?.id || null;
      if (responseJobs.length) {
        const mapped = responseJobs.map((job) => queueItemFromJob(job, {
          kind,
          title: `${kind} retry`,
          provider: job.provider || incident.provider,
          startedAt,
          total: responseJobs.length,
        }));
        setQueueItems(mapped.slice(-QUEUE_LIMIT));
        setJobId(mapped[0]?.jobId || '');
      }

      if (batchId) {
        setStatus('Retry accepted. A new Job is processing.');
        const pollResult = await pollGenerationBatch(batchId, {
          intervalMs: 3000,
          maxAttempts: 80,
          onTick: ({ batch, jobs }) => {
            const nextItems = jobs.map((job) => queueItemFromJob(job, {
              kind,
              title: `${kind} retry`,
              provider: job.provider || incident.provider,
              startedAt,
              total: jobs.length,
            }));
            setQueueItems(nextItems.slice(-QUEUE_LIMIT));
            const active = nextItems.find((item) => !TERMINAL_QUEUE_STATES.has(item.status));
            setJobStatus(active?.status || String(batch.status || 'processing').toLowerCase());
            const completed = nextItems.find((item) => item.outputUrl);
            if (completed?.outputUrl) setAssetUrl(completed.outputUrl);
          },
        });
        await finishLedger();
        if (pollResult.ok && pollResult.completed) {
          const firstOutput = pollResult.data?.batch?.jobs?.find((item) => item.outputUrl)?.outputUrl || '';
          if (firstOutput) setAssetUrl(firstOutput);
          setIncident(null);
          setIncidentAction('');
          setJobStatus('completed');
          setStatus('Retry completed successfully.');
        } else if (!pollResult.timedOut) {
          const failedJob = pollResult.data?.batch?.jobs?.find((item) => ['failed', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase()));
          const message = readableStudioMessage(pollResult.message || failedJob?.error?.message || 'Retry failed.');
          setIncident(incidentFromPayload({ ...pollResult.data, job: failedJob }, { message, batchId }));
          setError(message);
          setJobStatus('failed');
          setStatus(message);
        }
        return pollResult;
      }

      const asyncJob = extractAsyncJob(result);
      if (asyncJob.jobId) {
        setJobId(asyncJob.jobId);
        const pollResult = await pollJob(asyncJob.jobId, asyncJob.provider || incident.provider, { intervalMs: 3000, maxAttempts: 80 });
        await finishLedger();
        if (pollResult.ok && pollResult.completed) {
          const output = extractOutputUrl(pollResult);
          if (output) setAssetUrl(output);
          setIncident(null);
          setIncidentAction('');
          setJobStatus('completed');
          setStatus('Retry completed successfully.');
        } else {
          const message = readableStudioMessage(pollResult.message || pollResult.data?.job?.error?.message || 'Retry failed.');
          setIncident(incidentFromPayload(pollResult, { message, jobId: asyncJob.jobId }));
          setError(message);
          setJobStatus('failed');
          setStatus(message);
        }
        return pollResult;
      }
      return result;
    } finally {
      setRetrying(false);
      setGenerating(false);
    }
  };

  return {
    assetUrl,
    error,
    generating,
    jobId,
    jobStatus,
    incident,
    incidentAction,
    ledger,
    now,
    queueItems,
    retrying,
    retryLastGeneration,
    sendIncidentReport,
    status,
    setStatus,
    runGenerate,
  };
}
