import { apiRequest } from './api-client';

async function readResource(path, label) {
  const result = await apiRequest(path, { method: 'GET', timeoutMs: 15000 });

  if (!result.ok) {
    const error = new Error(result.message || `Could not load ${label}.`);
    error.status = result.status;
    throw error;
  }

  return result.data || {};
}

export const videoStudioReadApi = {
  projects() {
    return readResource('/api/projects', 'projects');
  },

  assets() {
    return readResource('/api/assets', 'assets');
  },

  history() {
    return readResource('/api/history', 'history');
  },

  jobs() {
    return readResource('/api/jobs?kind=video&limit=50', 'video jobs');
  },

  ledger() {
    return readResource('/api/ledger', 'credit ledger');
  },
};
