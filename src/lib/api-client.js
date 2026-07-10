import { getSession, readStore, storageKeys, writeStore } from './storage';

const DEV_PORTS = ['5173', '4173', '4188'];

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

  const localApiBase = window.location.protocol === 'file:' || DEV_PORTS.includes(window.location.port)
    ? 'http://127.0.0.1:3000'
    : window.location.origin;

  return (localStorage.getItem('slt-api-base') || window.SLT_API_BASE || localApiBase).replace(/\/$/, '');
}

export function readableStudioMessage(message = '') {
  const text = String(message || '');
  if (/not enough credits|insufficient credits/i.test(text)) return 'No tenés créditos suficientes para esta acción.';
  if (/provider not connected|add api key/i.test(text)) return 'Proveedor no conectado. Falta API key o configuración.';
  if (/stripe setup required/i.test(text)) return 'Stripe todavía no está configurado para este flujo.';
  if (/missing api key/i.test(text)) return 'Falta pegar la API key en el .env.';
  if (/missing endpoint|missing config/i.test(text)) return 'Falta completar URL o configuración.';
  return text || 'Something went wrong. Try again.';
}

export async function apiRequest(path, options = {}) {
  const session = getSession();
  const method = options.method || 'GET';
  const body = options.body;

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-slt-user-id': session?.id || 'demo-user',
        'x-slt-session': session?.token || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

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
    return {
      ok: false,
      online: false,
      error,
      message: 'Proveedor no conectado. Revisá la API key, URL o el servidor local.',
    };
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
}) {
  const endpoint = GENERATE_ENDPOINTS[kind];
  if (!endpoint) {
    return { ok: false, online: false, message: `Unsupported studio kind: ${kind}` };
  }

  return apiRequest(endpoint, {
    method: 'POST',
    body: {
      title: title || `${kind} project`,
      kind,
      prompt: prompt || '',
      provider,
      providerLabel: providerLabel || provider,
      tool: tool || title,
      actionId: actionId || String(tool || title).toLowerCase().replace(/\s+/g, '_'),
      status: 'processing',
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

export async function pollJob(jobId, provider, { intervalMs = 3000, maxAttempts = 40, onTick } = {}) {
  const normalizedProvider = normalizeJobProvider(provider);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    onTick?.({ attempt, maxAttempts, jobId, provider: normalizedProvider });

    const result = await apiRequest(
      `/api/jobs/${encodeURIComponent(jobId)}?provider=${encodeURIComponent(normalizedProvider)}`,
    );

    if (!result.ok) return result;

    const jobStatus = result.data?.job?.status || 'processing';

    if (jobStatus === 'completed') {
      return { ...result, completed: true };
    }

    if (jobStatus === 'failed') {
      return {
        ok: false,
        online: true,
        data: result.data,
        message: readableStudioMessage(result.data?.message || 'Job failed.'),
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

export function extractAsyncJob(result) {
  const item = result?.data?.historyItem;
  const payload = item?.result || result?.data?.result || {};
  const jobId = payload.providerJobId || payload.jobId || null;
  const provider = item?.provider || result?.data?.checks?.provider?.name || '';
  const note = String(payload.note || '');
  const status = String(payload.status || item?.status || '');
  const needsPoll = Boolean(
    jobId && (/poll \/api\/jobs/i.test(note) || status === 'processing'),
  );

  return { jobId, provider, needsPoll };
}

export async function fetchBilling() {
  return apiRequest('/api/billing');
}

export async function fetchSubscription() {
  return apiRequest('/api/subscription');
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

export async function createStripeCheckout(plan, email, interval = 'monthly') {
  return apiRequest('/api/stripe/checkout', {
    method: 'POST',
    body: { plan, interval, email },
  });
}

export async function createCreditsCheckout(packId, email) {
  return apiRequest('/api/stripe/credits/checkout', {
    method: 'POST',
    body: { packId, email },
  });
}

export async function openStripePortal() {
  return apiRequest('/api/stripe/portal', { method: 'POST', body: {} });
}
