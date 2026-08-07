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
  const rawBody = options.rawBody;
  const token = localStorage.getItem('sessionToken') || session?.token || '';
  const timeoutMs = options.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: {
        ...(rawBody === undefined ? { 'Content-Type': 'application/json' } : {}),
        'x-slt-site-gate': siteGateHeaderValue(),
        'x-slt-user-id': session?.id || 'demo-user',
        'x-slt-session': session?.token || '',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
      body: rawBody !== undefined ? rawBody : (body ? JSON.stringify(body) : undefined),
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

export async function fetchGenerationBatch(batchId) {
  return apiRequest(`/api/batches/${encodeURIComponent(batchId)}`, { timeoutMs: 45000 });
}

export async function pollGenerationBatch(batchId, { intervalMs = 3000, maxAttempts = 80, onTick } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await fetchGenerationBatch(batchId);
    if (!result.ok) return result;

    const batch = result.data?.batch || {};
    const jobs = Array.isArray(batch.jobs) ? batch.jobs : [];
    const terminalJobs = jobs.filter((job) => TERMINAL_JOB_STATES.has(String(job.status || '').toLowerCase()));
    const allTerminal = jobs.length > 0 && terminalJobs.length === jobs.length;
    onTick?.({ attempt, maxAttempts, batchId, batch, jobs, result });

    if (allTerminal) {
      const completedJobs = jobs.filter((job) => String(job.status || '').toLowerCase() === 'completed');
      return {
        ...result,
        completed: completedJobs.length > 0,
        partial: completedJobs.length > 0 && completedJobs.length < jobs.length,
        failed: completedJobs.length === 0,
      };
    }

    await sleep(intervalMs);
  }

  return {
    ok: false,
    online: true,
    timedOut: true,
    message: 'Batch timed out while processing.',
  };
}

export async function fetchModelCapabilities(modality = '') {
  const query = modality ? `?modality=${encodeURIComponent(modality)}` : '';
  return apiRequest(`/api/model-router/capabilities${query}`, { timeoutMs: 25000 });
}

export async function resolveModelRoute(payload = {}) {
  return apiRequest('/api/model-router/resolve', {
    method: 'POST',
    timeoutMs: 25000,
    body: payload,
  });
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

export async function estimateGenerationCost(kind, payload = {}) {
  return apiRequest('/api/generate/estimate', {
    method: 'POST',
    timeoutMs: 15000,
    body: { kind, ...payload },
  });
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

export async function reportIncident(incidentId, { route = '', note = '' } = {}) {
  return apiRequest('/api/support/incidents', {
    method: 'POST',
    timeoutMs: 25000,
    body: { incidentId, route, note },
  });
}

export async function retryGenerationJob(jobId, overrides = {}) {
  return apiRequest(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    timeoutMs: 125000,
    body: { overrides },
  });
}

export async function fetchCompensationCoupons() {
  return apiRequest('/api/compensation/coupons', { timeoutMs: 25000 });
}

export async function fetchCeoErrors(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/ceo/errors${suffix}`, { timeoutMs: 25000 });
}

export async function fetchCeoError(incidentId) {
  return apiRequest(`/api/ceo/errors/${encodeURIComponent(incidentId)}`, { timeoutMs: 25000 });
}

export async function updateCeoError(incidentId, status, note = '') {
  return apiRequest(`/api/ceo/errors/${encodeURIComponent(incidentId)}`, {
    method: 'PATCH',
    timeoutMs: 25000,
    body: { status, note },
  });
}

export async function refreshCeoProviderDiagnostics(provider = 'all') {
  return apiRequest('/api/ceo/providers/refresh', {
    method: 'POST',
    timeoutMs: 45000,
    body: { provider },
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

export async function uploadReferenceAsset({
  file,
  kind = 'reference',
  module = kind,
  role = 'reference',
  projectId = null,
  sessionId = null,
  note = '',
  durationSeconds = null,
}) {
  if (!file) return { ok: false, message: 'No file selected.' };
  const metadata = {
    kind,
    module,
    role,
    projectId,
    sessionId,
    note,
    fileName: file.name || 'upload.bin',
    contentType: file.type || 'application/octet-stream',
    bytes: file.size,
    durationSeconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
  };
  const preflight = await apiRequest('/api/uploads/signed', {
    method: 'POST',
    timeoutMs: 30000,
    body: metadata,
  });
  if (!preflight.ok) return preflight;

  if (preflight.data?.mode === 'signed') {
    try {
      const uploadResponse = await fetch(preflight.data.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': metadata.contentType,
          'x-upsert': 'false',
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        return {
          ok: false,
          online: true,
          status: uploadResponse.status,
          message: `Storage upload failed with HTTP ${uploadResponse.status}.`,
        };
      }
      return apiRequest(preflight.data.completeUrl || '/api/uploads/complete', {
        method: 'POST',
        timeoutMs: 240000,
        body: {
          storageKey: preflight.data.storageKey,
          metadata,
        },
      });
    } catch (error) {
      return { ok: false, online: false, error, message: 'The direct storage upload could not be completed.' };
    }
  }

  const query = new URLSearchParams({
    kind,
    module,
    role,
    fileName: file.name || 'upload.bin',
  });
  if (projectId) query.set('projectId', projectId);
  if (sessionId) query.set('sessionId', sessionId);
  if (note) query.set('note', note);
  if (Number.isFinite(Number(durationSeconds))) query.set('durationSeconds', String(durationSeconds));

  return apiRequest(`/api/assets/upload-binary?${query.toString()}`, {
    method: 'POST',
    timeoutMs: 240000,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    rawBody: file,
  });
}

export async function fetchAssets(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/assets${suffix}`, { timeoutMs: 25000 });
}

export async function fetchProjects() {
  return apiRequest('/api/projects', { timeoutMs: 25000 });
}

export async function fetchProject(projectId) {
  return apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { timeoutMs: 25000 });
}

export async function updateProject(projectId, payload) {
  return apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function archiveProject(projectId) {
  return apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', timeoutMs: 25000 });
}

export async function fetchGenerationSessions(kind = '') {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return apiRequest(`/api/generation-sessions${query}`, { timeoutMs: 25000 });
}

export async function createGenerationSession(payload) {
  return apiRequest('/api/generation-sessions', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function fetchGenerationSession(sessionId) {
  return apiRequest(`/api/generation-sessions/${encodeURIComponent(sessionId)}`, { timeoutMs: 25000 });
}

export async function updateGenerationSession(sessionId, payload) {
  return apiRequest(`/api/generation-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function fetchGenerationJobs(kind = '', limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (kind) query.set('kind', kind);
  return apiRequest(`/api/jobs?${query.toString()}`, { timeoutMs: 25000 });
}

export async function fetchGenerationBatches(kind = '') {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return apiRequest(`/api/batches${query}`, { timeoutMs: 25000 });
}

export async function fetchHistory(kind = '') {
  const result = await apiRequest('/api/history', { timeoutMs: 25000 });
  if (!kind || !result.ok || !Array.isArray(result.data?.history)) return result;
  return {
    ...result,
    data: {
      ...result.data,
      history: result.data.history.filter((item) => String(item.kind || '').toLowerCase() === kind),
    },
  };
}

export async function extractVideoFrame(assetId, timestampSeconds = 0) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}/extract-frame`, {
    method: 'POST',
    timeoutMs: 120000,
    body: { timestampSeconds },
  });
}

export async function deleteAsset(assetId) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE', timeoutMs: 25000 });
}

export async function fetchAsset(assetId) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}`, { timeoutMs: 25000 });
}

export async function updateAsset(assetId, payload) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function runAssetAction(assetId, action, payload = {}) {
  return apiRequest(`/api/assets/${encodeURIComponent(assetId)}/actions`, {
    method: 'POST',
    body: { action, ...payload },
    timeoutMs: 25000,
  });
}

export async function fetchVersions(assetId = '') {
  const path = assetId
    ? `/api/assets/${encodeURIComponent(assetId)}/versions`
    : '/api/versions';
  const result = await apiRequest(path, { timeoutMs: 25000 });
  if (!result.ok || !Array.isArray(result.data?.lineages)) return result;
  return {
    ...result,
    data: {
      ...result.data,
      versions: result.data.lineages.flatMap((lineage) => lineage.versions || []),
    },
  };
}

export async function fetchReferences(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/references${suffix}`, { timeoutMs: 25000 });
}

export async function createReference(payload) {
  return apiRequest('/api/references', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function updateReference(referenceId, payload) {
  return apiRequest(`/api/references/${encodeURIComponent(referenceId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function deleteReference(referenceId) {
  return apiRequest(`/api/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE', timeoutMs: 25000 });
}

export async function fetchScenes(projectId = '') {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return apiRequest(`/api/scenes${query}`, { timeoutMs: 25000 });
}

export async function createScene(payload) {
  return apiRequest('/api/scenes', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function fetchScene(sceneId) {
  return apiRequest(`/api/scenes/${encodeURIComponent(sceneId)}`, { timeoutMs: 25000 });
}

export async function updateScene(sceneId, payload) {
  return apiRequest(`/api/scenes/${encodeURIComponent(sceneId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function addSceneItem(sceneId, payload) {
  return apiRequest(`/api/scenes/${encodeURIComponent(sceneId)}/items`, {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function removeSceneItem(sceneId, itemId) {
  return apiRequest(`/api/scenes/${encodeURIComponent(sceneId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    timeoutMs: 25000,
  });
}

export async function fetchTimeline(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/timeline${suffix}`, { timeoutMs: 25000 });
}

export async function createTimelineItem(payload) {
  return apiRequest('/api/timeline', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function updateTimelineItem(itemId, payload) {
  return apiRequest(`/api/timeline/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function deleteTimelineItem(itemId) {
  return apiRequest(`/api/timeline/${encodeURIComponent(itemId)}`, { method: 'DELETE', timeoutMs: 25000 });
}

export async function fetchWorkflows() {
  return apiRequest('/api/workflows', { timeoutMs: 25000 });
}

export async function createWorkflow(payload) {
  return apiRequest('/api/workflows', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function addWorkflowNode(workflowId, payload) {
  return apiRequest(`/api/workflows/${encodeURIComponent(workflowId)}/nodes`, {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function addWorkflowEdge(workflowId, payload) {
  return apiRequest(`/api/workflows/${encodeURIComponent(workflowId)}/edges`, {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function fetchApplications() {
  return apiRequest('/api/applications', { timeoutMs: 25000 });
}

export async function createApplication(payload) {
  return apiRequest('/api/applications', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function fetchProviderStatus() {
  return apiRequest('/api/provider-status', { timeoutMs: 25000 });
}

export async function fetchCharacters() {
  return apiRequest('/api/characters', { timeoutMs: 25000 });
}

export async function createCharacter(payload) {
  return apiRequest('/api/characters', { method: 'POST', body: payload, timeoutMs: 25000 });
}

export async function fetchCharacter(characterId) {
  return apiRequest(`/api/characters/${encodeURIComponent(characterId)}`, { timeoutMs: 25000 });
}

export async function fetchCharacterReference(characterId) {
  return apiRequest(`/api/characters/${encodeURIComponent(characterId)}/use`, { timeoutMs: 25000 });
}

export async function setCharacterConsent(characterId, payload) {
  return apiRequest(`/api/characters/${encodeURIComponent(characterId)}/consent`, {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function linkCharacterAsset(characterId, payload) {
  return apiRequest(`/api/characters/${encodeURIComponent(characterId)}/assets`, {
    method: 'POST',
    body: payload,
    timeoutMs: 25000,
  });
}

export async function createCharacterVersion(characterId) {
  return apiRequest(`/api/characters/${encodeURIComponent(characterId)}/versions`, {
    method: 'POST',
    body: {},
    timeoutMs: 25000,
  });
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
