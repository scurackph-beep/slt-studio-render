import { getSession, readStore, storageKeys, writeStore } from './storage';
import { siteGateHeaderValue } from './site-gate';

const GENERATE_ENDPOINTS = {
  video: '/api/generate/video',
  image: '/api/generate/image',
  music: '/api/generate/music',
  sound: '/api/generate/sound',
};

export function getApiBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3000';

  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE.replace(/\/$/, '');
  }

  const isLocalFrontend =
    window.location.protocol === 'file:'
    || (['127.0.0.1', 'localhost'].includes(window.location.hostname) && window.location.port !== '3000');

  const localApiBase = isLocalFrontend
    ? 'http://127.0.0.1:3000'
    : window.location.origin;

  return (localStorage.getItem('slt-api-base') || window.SLT_API_BASE || localApiBase).replace(/\/$/, '');
}

export function readableStudioMessage(message = '') {
  const text = String(message || '');
  if (/authentication required|auth_required|please log in|unauthorized/i.test(text)) return 'Log in from Profile before using this action.';
  if (/PAYMENT_REQUIRED|not enough credits|insufficient credits/i.test(text)) return 'You do not have enough credits for this action.';
  if (/provider not connected|add api key/i.test(text)) return 'Provider not connected. API key or configuration is missing.';
  if (/stripe setup required/i.test(text)) return 'Stripe is not configured for this flow yet.';
  if (/missing api key/i.test(text)) return 'Missing API key in the .env file.';
  if (/missing endpoint|missing config/i.test(text)) return 'Missing URL or configuration.';
  return text || 'Something went wrong. Try again.';
}

export async function apiRequest(path, options = {}) {
  const session = getSession();
  const method = options.method || 'GET';
  const body = options.body;
  const token = localStorage.getItem('sessionToken') || session?.token || '';
  const timeoutMs = options.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-slt-site-gate': siteGateHeaderValue(),
        'x-slt-user-id': session?.id || 'demo-user',
        'x-slt-session': session?.token || '',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutMs > 0 ? controller.signal : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 402 || response.status === 403) {
      return {
        ok: false,
        online: true,
        status: response.status,
        data,
        message: readableStudioMessage(
          data.code === 'site_gate_required'
            ? 'Private access. Enter the site code.'
            : (data.readableError || data.error || data.warning || 'PAYMENT_REQUIRED'),
        ),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        online: true,
        status: response.status,
        data,
        message: readableStudioMessage(data.readableError || data.error || data.warning),
      };
    }

    return { ok: true, online: true, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        ok: false,
        online: true,
        error,
        message: 'The provider took too long. The app released the button so you can change provider or try again.',
      };
    }
    return {
      ok: false,
      online: false,
      error,
      message: 'Provider not connected. Check the API key, URL or local server.',
    };
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
}

export async function checkHealth() {
  return apiRequest('/health');
}

export async function fetchProviders() {
  return apiRequest('/api/providers');
}

export async function refreshBackendState() {
  const [health, subscription, billing, user, projects, history, providers] = await Promise.all([
    checkHealth(),
    apiRequest('/api/subscription'),
    apiRequest('/api/billing'),
    apiRequest('/api/user'),
    apiRequest('/api/projects'),
    apiRequest('/api/history'),
    fetchProviders(),
  ]);

  if (subscription.ok && subscription.data.subscription) {
    writeStore(storageKeys.subscription, subscription.data.subscription);
  }

  if (billing.ok && billing.data.billing) {
    writeStore(storageKeys.billing, billing.data.billing);
  }

  if (user.ok && user.data.user) {
    const current = readStore(storageKeys.user, {});
    writeStore(storageKeys.user, { ...current, ...user.data.user });
  }

  if (projects.ok && Array.isArray(projects.data.projects)) {
    const local = readStore(storageKeys.projects, []);
    writeStore(storageKeys.projects, [...projects.data.projects, ...local].slice(0, 30));
  }

  if (history.ok && Array.isArray(history.data.history)) {
    const local = readStore(storageKeys.history, []);
    writeStore(storageKeys.history, [...history.data.history, ...local].slice(0, 40));
  }

  if (providers.ok && Array.isArray(providers.data.providers)) {
    writeStore(storageKeys.providers, providers.data.providers);
  }

  return {
    online: health.ok,
    providers: providers.ok ? providers.data.providers || [] : readStore(storageKeys.providers, []),
    subscription: subscription.ok ? subscription.data.subscription : readStore(storageKeys.subscription, null),
    billing: billing.ok ? billing.data.billing : readStore(storageKeys.billing, null),
    providerCount: providers.ok ? providers.data.providers?.length || 0 : 0,
  };
}

export async function generateStudio({
  kind,
  title,
  prompt,
  provider,
  providerLabel,
  tool,
  actionId,
  ...payload
}) {
  const endpoint = GENERATE_ENDPOINTS[kind];
  if (!endpoint) {
    return { ok: false, online: false, message: `Unsupported studio kind: ${kind}` };
  }

  return apiRequest(endpoint, {
    method: 'POST',
    timeoutMs: kind === 'video' ? 125000 : 90000,
    body: {
      title: title || `${kind} project`,
      kind,
      prompt: prompt || '',
      provider,
      providerLabel: providerLabel || provider,
      tool: tool || title,
      actionId: actionId || String(tool || title).toLowerCase().replace(/\s+/g, '_'),
      status: 'processing',
      ...payload,
    },
  });
}

export async function assistStudio({ prompt, provider = 'OpenAI', title = 'Studio Assistant' }) {
  return apiRequest('/api/assist', {
    method: 'POST',
    body: {
      title,
      kind: 'assist',
      provider,
      providerLabel: provider,
      tool: title,
      prompt,
    },
  });
}

export function normalizeJobProvider(name = '') {
  const value = String(name || '');
  if (/seedance/i.test(value)) return 'Seedance';
  if (/omnihuman/i.test(value)) return 'OmniHuman';
  return value.split('/')[0].trim().split(/\s+/)[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled', 'canceled']);

export async function pollJob(jobId, provider, { intervalMs = 3000, maxAttempts = 40, onTick } = {}) {
  const normalizedProvider = normalizeJobProvider(provider);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let result = await apiRequest(`/api/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 45000 });

    if (!result.ok && result.status === 404 && normalizedProvider) {
      result = await apiRequest(
        `/api/jobs/${encodeURIComponent(jobId)}?provider=${encodeURIComponent(normalizedProvider)}`,
        { timeoutMs: 45000 },
      );
    }

    if (!result.ok) return result;

    const jobStatus = String(result.data?.job?.status || result.data?.job?.state || 'processing').toLowerCase();
    onTick?.({ attempt, maxAttempts, jobId, provider: normalizedProvider, status: jobStatus, result });

    if (jobStatus === 'completed') {
      return { ...result, completed: true };
    }

    if (TERMINAL_JOB_STATES.has(jobStatus)) {
      return {
        ok: false,
        online: true,
        data: result.data,
        message: readableStudioMessage(result.data?.message || result.data?.job?.error?.message || 'Job failed.'),
      };
    }

    await sleep(intervalMs);
  }

  return {
    ok: false,
    online: true,
    message: 'Job timed out while processing.',
  };
}

export async function saveProject(body) {
  return apiRequest('/api/projects', {
    method: 'POST',
    body,
  });
}

function firstUrl(...groups) {
  return groups
    .flatMap((group) => (Array.isArray(group) ? group : [group]))
    .find((url) => typeof url === 'string' && url.trim()) || null;
}

export function extractOutputUrl(result) {
  const item = result?.data?.historyItem;
  const project = result?.data?.project;
  const payload = item?.result || result?.data?.result || project?.result || {};
  const job = result?.data?.job || {};
  const platformUrl = firstUrl(
    job.outputUrl,
    job.outputUrls,
    payload.outputUrl,
    payload.outputUrls,
    payload.previewUrl,
    project?.result?.outputUrl,
    project?.result?.outputUrls,
  );

  return platformUrl;
}

export function extractAsyncJob(result) {
  const item = result?.data?.historyItem;
  const job = result?.data?.job || {};
  const payload = item?.result || result?.data?.result || {};
  const jobId = result?.data?.jobId
    || result?.data?.request_id
    || job.jobId
    || job.id
    || payload.jobId
    || payload.request_id
    || payload.providerJobId
    || null;
  const provider = job.provider
    || item?.provider
    || result?.data?.checks?.requestedProvider?.name
    || result?.data?.checks?.provider?.name
    || '';
  const note = String(result?.data?.message || payload.note || '');
  const status = String(job.status || payload.status || item?.status || result?.data?.status || '').toLowerCase();
  const needsPoll = Boolean(
    jobId
    && (
      result?.data?.accepted
      || result?.data?.async
      || /poll \/api\/jobs/i.test(note)
      || ['queued', 'processing', 'in_queue', 'in_progress'].includes(status)
    ),
  );

  return { jobId, provider, needsPoll, status };
}

export async function fetchBilling() {
  return apiRequest('/api/billing');
}

export async function fetchSubscription() {
  return apiRequest('/api/subscription');
}

export async function fetchLedger() {
  return apiRequest('/api/ledger', { timeoutMs: 25000 });
}

export async function updateSubscription(action, plan, reason = '') {
  return apiRequest('/api/subscription', {
    method: 'POST',
    body: { action, plan, reason },
  });
}

export async function fetchCreditPacks() {
  return apiRequest('/api/credits/packs');
}

export async function fetchCeoProviderCredits() {
  return apiRequest('/api/ceo/provider-credits', {
    timeoutMs: 25000,
  });
}

export async function createStripeCheckout(plan, email, interval = 'monthly') {
  return apiRequest('/api/billing/checkout', {
    method: 'POST',
    body: { plan, interval, email },
  });
}

export async function createCreditsCheckout(packId, email) {
  return apiRequest('/api/billing/credits/checkout', {
    method: 'POST',
    body: { packId, email },
  });
}

export async function openStripePortal() {
  return apiRequest('/api/stripe/portal', { method: 'POST', body: {} });
}

export async function uploadReferenceAsset({ file, kind = 'reference', module = kind, role = 'reference', projectId = null, note = '' }) {
  if (!file) return { ok: false, message: 'No file selected.' };
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

  return apiRequest('/api/assets/upload', {
    method: 'POST',
    timeoutMs: 60000,
    body: {
      kind,
      module,
      role,
      projectId,
      note,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      dataUrl,
    },
  });
}

export async function fetchAssets() {
  return apiRequest('/api/assets', { timeoutMs: 25000 });
}

export async function deleteAsset(assetId) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE', timeoutMs: 25000 });
}

export function assetDownloadUrl(assetId) {
  return `${getApiBase()}/api/assets/${encodeURIComponent(assetId)}/download`;
}

export async function submitPlatformForm(kind, body) {
  return apiRequest(`/api/forms/${encodeURIComponent(kind || 'contact')}`, {
    method: 'POST',
    timeoutMs: 25000,
    body,
  });
}
