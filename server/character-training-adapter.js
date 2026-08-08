const VALID_STATES = new Set(["DATASET", "VALIDATING", "TRAINING", "READY", "FAILED"]);

function normalizeState(value = "TRAINING") {
  const state = String(value || "TRAINING").trim().toUpperCase();
  if (["QUEUED", "PENDING", "STARTING", "PROCESSING", "RUNNING"].includes(state)) return "TRAINING";
  if (["SUCCEEDED", "SUCCESS", "COMPLETE", "COMPLETED"].includes(state)) return "READY";
  if (["ERROR", "ERRORED", "CANCELLED", "CANCELED"].includes(state)) return "FAILED";
  return VALID_STATES.has(state) ? state : "TRAINING";
}

function unavailableError() {
  const error = new Error("Trained Character Models are Coming Soon because no training provider is configured. Reference-ready Characters remain available in Image, Video and Scene Builder.");
  error.code = "character_training_provider_unavailable";
  error.statusCode = 409;
  return error;
}

export function createCharacterTrainingAdapter(env = process.env) {
  const baseUrl = String(env.CHARACTER_TRAINING_API_URL || "").replace(/\/$/, "");
  const apiKey = String(env.CHARACTER_TRAINING_API_KEY || "");
  const provider = String(env.CHARACTER_TRAINING_PROVIDER || "External Character Training");
  const configured = Boolean(baseUrl && apiKey);

  async function request(path, options = {}) {
    if (!configured) throw unavailableError();
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error?.message || `Character training provider returned HTTP ${response.status}.`);
      error.code = data.code || `character_training_http_${response.status}`;
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  return {
    provider,
    configured,
    status() {
      return {
        configured,
        provider: configured ? provider : null,
        status: configured ? "AVAILABLE" : "COMING_SOON",
        reason: configured ? null : "CHARACTER_TRAINING_PROVIDER_NOT_CONFIGURED"
      };
    },
    async createTraining({ characterId, assets, configuration = {} }) {
      const data = await request("/trainings", { method: "POST", body: { characterId, assets, configuration } });
      return {
        externalTrainingId: data.id || data.training_id || data.trainingId,
        status: normalizeState(data.status),
        modelRef: data.model_ref || data.modelRef || data.model_id || null,
        raw: data
      };
    },
    async getTrainingStatus(externalTrainingId) {
      const data = await request(`/trainings/${encodeURIComponent(externalTrainingId)}`);
      return {
        externalTrainingId,
        status: normalizeState(data.status),
        modelRef: data.model_ref || data.modelRef || data.model_id || null,
        error: data.error?.message || data.error || null,
        raw: data
      };
    },
    async getCharacterModel(externalTrainingId) {
      const data = await request(`/trainings/${encodeURIComponent(externalTrainingId)}/model`);
      return { modelRef: data.model_ref || data.modelRef || data.model_id || data.id || null, raw: data };
    },
    async deleteCharacterModel(externalTrainingId) {
      await request(`/trainings/${encodeURIComponent(externalTrainingId)}`, { method: "DELETE" });
      return { deleted: true, externalTrainingId };
    }
  };
}
