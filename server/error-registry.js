import crypto from "node:crypto";

const definitionRows = [
  ["SLT-1001", "USER_INSUFFICIENT_CREDITS", "CREDIT", "The user does not have enough SLT credits.", "You do not have enough credits for this generation.", false, false],
  ["SLT-1002", "PROVIDER_NO_CREDITS", "CREDIT", "External provider account has insufficient compute balance.", "This generation engine is temporarily unavailable. Your credits were not charged.", false, true],
  ["SLT-1003", "PROVIDER_BILLING_REQUIRED", "CREDIT", "External provider billing must be enabled before requests can run.", "This generation engine is temporarily unavailable while provider billing is enabled. Your credits were not charged.", false, true],
  ["SLT-1004", "CREDIT_RESERVATION_FAILED", "CREDIT", "The credit reservation transaction failed.", "We could not reserve the credits for this generation. No credits were charged.", true, true],
  ["SLT-1005", "CREDIT_CAPTURE_FAILED", "CREDIT", "The credit capture transaction failed.", "We could not finalize the generation charge. Our technical team can review the incident.", true, true],
  ["SLT-1006", "CREDIT_RELEASE_FAILED", "CREDIT", "The credit release transaction failed.", "We could not confirm the automatic credit return. Our technical team has the details.", true, true],
  ["SLT-1101", "SESSION_EXPIRED", "AUTH", "The authenticated session is missing or expired.", "Your session expired. Please sign in again.", false, false],
  ["SLT-1102", "INVALID_API_CREDENTIALS", "AUTH", "Required SLT API credentials are missing or invalid.", "This service is not configured correctly right now.", false, true],
  ["SLT-1103", "PROVIDER_AUTH_FAILED", "AUTH", "The external provider rejected its configured credentials.", "This generation engine could not authenticate. Your credits were not charged.", false, true],
  ["SLT-1104", "PERMISSION_DENIED", "AUTH", "The authenticated identity does not have permission for this operation.", "You do not have permission to perform this action.", false, false],
  ["SLT-1201", "MODEL_NOT_FOUND", "MODEL", "The requested provider model identifier was not found.", "The selected model could not be found. Choose another available model.", false, false],
  ["SLT-1202", "MODEL_NOT_AVAILABLE", "MODEL", "The requested model is not currently available.", "The selected model is temporarily unavailable.", true, true],
  ["SLT-1203", "MODEL_ACCESS_DENIED", "MODEL", "The provider account does not have access to the requested model.", "This account does not currently have access to the selected model.", false, true],
  ["SLT-1204", "MODEL_PARAMETER_UNSUPPORTED", "MODEL", "One or more generation parameters are unsupported by the selected model.", "The selected model does not support one of these settings.", false, false],
  ["SLT-1205", "MODEL_TEMPORARILY_DISABLED", "MODEL", "The selected model is disabled by current provider configuration.", "The selected model is temporarily disabled.", true, true],
  ["SLT-1301", "INVALID_PROMPT", "INPUT", "The prompt is empty, malformed or outside accepted constraints.", "Please revise the prompt and try again.", false, false],
  ["SLT-1302", "INVALID_REFERENCE", "INPUT", "A required reference is missing, invalid or inaccessible.", "One of the selected references cannot be used.", false, false],
  ["SLT-1303", "FILE_TOO_LARGE", "INPUT", "The uploaded file exceeds the accepted size limit.", "This file is too large. Choose a smaller file.", false, false],
  ["SLT-1304", "UNSUPPORTED_FORMAT", "INPUT", "The uploaded media format is unsupported.", "This file format is not supported.", false, false],
  ["SLT-1305", "UNSUPPORTED_CODEC", "INPUT", "The uploaded media codec is unsupported.", "This media codec is not supported. Export the file with a supported codec.", false, false],
  ["SLT-1306", "INVALID_DURATION", "INPUT", "The requested or uploaded media duration is outside accepted limits.", "The duration is outside the allowed range.", false, false],
  ["SLT-1307", "INVALID_RESOLUTION", "INPUT", "The requested or uploaded resolution is unsupported.", "The selected resolution is not supported.", false, false],
  ["SLT-1308", "INVALID_FPS", "INPUT", "The uploaded frame rate is unsupported.", "The frame rate is not supported.", false, false],
  ["SLT-1309", "CORRUPTED_FILE", "INPUT", "The uploaded media file is corrupted or unreadable.", "This file appears to be damaged or unreadable.", false, false],
  ["SLT-1401", "PROMPT_BLOCKED", "MODERATION", "Input moderation rejected the prompt.", "This prompt cannot be processed under the content policy.", false, false],
  ["SLT-1402", "INPUT_MEDIA_BLOCKED", "MODERATION", "Input moderation rejected the uploaded media.", "This media cannot be processed under the content policy.", false, false],
  ["SLT-1403", "OUTPUT_BLOCKED", "MODERATION", "Output moderation rejected the generated media.", "The generated result could not be delivered under the content policy. Your credits were returned.", false, false],
  ["SLT-1501", "PROVIDER_REQUEST_FAILED", "PROVIDER", "The external provider request failed before a task was accepted.", "The generation service could not accept this request. Your credits were returned.", true, true],
  ["SLT-1502", "PROVIDER_TIMEOUT", "PROVIDER", "Provider request exceeded the configured timeout.", "The generation service took too long to respond. Your credits were returned.", true, true],
  ["SLT-1503", "PROVIDER_RATE_LIMIT", "PROVIDER", "The provider rate or quota limit was reached.", "The generation engine is receiving too many requests. Try again shortly.", true, true],
  ["SLT-1504", "PROVIDER_BUSY", "PROVIDER", "The provider reported temporary capacity exhaustion.", "The generation engine is busy right now. Try again shortly.", true, true],
  ["SLT-1505", "PROVIDER_GENERATION_FAILED", "PROVIDER", "The provider accepted the task but generation failed.", "The generation engine was unable to complete this request. Your credits were returned.", true, true],
  ["SLT-1506", "PROVIDER_INVALID_RESPONSE", "PROVIDER", "The provider returned an invalid or incomplete response.", "The generation service returned an invalid response. Your credits were returned.", true, true],
  ["SLT-1601", "UPLOAD_FAILED", "STORAGE", "An upload to SLT failed.", "The file could not be uploaded. Please try again.", true, true],
  ["SLT-1602", "SIGNED_UPLOAD_FAILED", "STORAGE", "A signed upload request failed.", "The secure upload could not be completed. Please try again.", true, true],
  ["SLT-1603", "PROVIDER_UPLOAD_FAILED", "STORAGE", "The provider rejected or failed to fetch an input upload.", "The generation engine could not receive the uploaded media. Your credits were returned.", true, true],
  ["SLT-1604", "STORAGE_WRITE_FAILED", "STORAGE", "Generated provider output could not be persisted to SLT Storage.", "Your generation finished, but we could not safely save the result. Your credits were returned.", true, true],
  ["SLT-1605", "STORAGE_READ_FAILED", "STORAGE", "SLT Storage could not read a required asset.", "A required asset could not be read. Please try again.", true, true],
  ["SLT-1606", "TEMPORARY_URL_EXPIRED", "STORAGE", "A provider temporary asset URL expired before persistence.", "The temporary generation link expired before it could be saved. Your credits were returned.", true, true],
  ["SLT-1701", "DATABASE_UNAVAILABLE", "DATABASE", "PostgreSQL is unavailable.", "The studio database is temporarily unavailable. Your credits were not charged.", true, true],
  ["SLT-1702", "DATABASE_QUERY_FAILED", "DATABASE", "A PostgreSQL query failed.", "The studio could not save this operation. Your credits were returned where applicable.", true, true],
  ["SLT-1703", "TRANSACTION_FAILED", "DATABASE", "A database transaction was rolled back.", "The studio could not safely complete this operation. Your credits were returned where applicable.", true, true],
  ["SLT-1704", "DATABASE_CONSTRAINT_ERROR", "DATABASE", "A database constraint rejected the operation.", "The studio could not save this operation because of a data conflict.", false, true],
  ["SLT-1705", "TENANT_DATA_ERROR", "DATABASE", "Tenant ownership data is missing or inconsistent.", "The studio could not verify ownership for this operation.", false, true],
  ["SLT-1801", "FFMPEG_NOT_AVAILABLE", "MEDIA", "FFmpeg is not installed or cannot be executed.", "Video processing is temporarily unavailable.", false, true],
  ["SLT-1802", "FFPROBE_NOT_AVAILABLE", "MEDIA", "ffprobe is not installed or cannot be executed.", "Video analysis is temporarily unavailable.", false, true],
  ["SLT-1803", "MEDIA_ANALYSIS_FAILED", "MEDIA", "Media analysis failed.", "The studio could not analyze this media file.", false, true],
  ["SLT-1804", "TRANSCODING_FAILED", "MEDIA", "Media transcoding failed.", "The studio could not process the media format. Your credits were returned where applicable.", true, true],
  ["SLT-1805", "FRAME_EXTRACTION_FAILED", "MEDIA", "Video frame extraction failed.", "The studio could not extract the requested frame.", true, true],
  ["SLT-1901", "NETWORK_TIMEOUT", "NETWORK", "An internal network request timed out.", "The studio network took too long to respond. Please try again.", true, true],
  ["SLT-1902", "DNS_ERROR", "NETWORK", "DNS resolution failed.", "The studio could not reach a required service. Please try again later.", true, true],
  ["SLT-1903", "CONNECTION_FAILED", "NETWORK", "A network connection was refused or interrupted.", "The studio could not connect to a required service. Please try again.", true, true],
  ["SLT-1904", "TLS_ERROR", "NETWORK", "A TLS or certificate validation error occurred.", "A secure connection could not be established. Please try again later.", true, true],
  ["SLT-2001", "INTERNAL_SLT_ERROR", "INTERNAL", "An internal SLT component failed after classification attempts.", "Something inside the studio failed. Your credits were returned where applicable.", true, true],
  ["SLT-2002", "UNKNOWN_JOB_ERROR", "INTERNAL", "A job failed without a classifiable error payload.", "The generation job ended unexpectedly. Your credits were returned.", true, true]
];

export const SLT_ERROR_REGISTRY = Object.freeze(Object.fromEntries(definitionRows.map((row) => {
  const [code, name, category, technicalMessage, customerMessage, retryable, compensationEligible] = row;
  return [code, Object.freeze({ code, name, category, technicalMessage, customerMessage, retryable, compensationEligible })];
})));

export const SLT_ERROR_BY_NAME = Object.freeze(Object.fromEntries(
  Object.values(SLT_ERROR_REGISTRY).map((definition) => [definition.name, definition])
));

const codeAliases = new Map([
  ["insufficient_credits", "USER_INSUFFICIENT_CREDITS"],
  ["auth_required", "SESSION_EXPIRED"],
  ["session_expired", "SESSION_EXPIRED"],
  ["forbidden", "PERMISSION_DENIED"],
  ["provider_not_connected", "PROVIDER_REQUEST_FAILED"],
  ["provider_webhook_failed", "PROVIDER_GENERATION_FAILED"],
  ["provider_job_failed", "PROVIDER_GENERATION_FAILED"],
  ["provider_simulated_503", "PROVIDER_GENERATION_FAILED"],
  ["asset_storage_failed", "STORAGE_WRITE_FAILED"],
  ["webhook_signature_invalid", "PROVIDER_AUTH_FAILED"],
  ["input_moderation_failed", "PROMPT_BLOCKED"],
  ["moderation_blocked", "PROMPT_BLOCKED"],
  ["reality_transform_source_required", "INVALID_REFERENCE"],
  ["reality_transform_video_required", "INVALID_REFERENCE"],
  ["reality_transform_validated_asset_required", "INVALID_REFERENCE"],
  ["reality_transform_revalidation_required", "INVALID_REFERENCE"],
  ["reality_transform_duration_invalid", "INVALID_DURATION"],
  ["reality_transform_native_resolution_invalid", "INVALID_RESOLUTION"],
  ["video_duration_limit", "INVALID_DURATION"],
  ["ceo_video_duration_limit", "INVALID_DURATION"],
  ["seedance_missing_image", "INVALID_REFERENCE"],
  ["omnihuman_missing_media_urls", "INVALID_REFERENCE"],
  ["invalid_held_balance", "CREDIT_RELEASE_FAILED"]
]);

function normalizedText(error, context = {}) {
  return [
    error?.code,
    error?.name,
    error?.message,
    error?.readableError,
    error?.cause?.message,
    context.provider,
    context.operation
  ].filter(Boolean).join(" ").toLowerCase();
}

function definitionForName(name) {
  return SLT_ERROR_BY_NAME[name] || SLT_ERROR_BY_NAME.INTERNAL_SLT_ERROR;
}

function classifyByText(error = {}, context = {}) {
  const text = normalizedText(error, context);
  const status = Number(error.statusCode || error.status || context.httpStatus || 0);
  const provider = String(context.provider || "").toLowerCase();

  if (codeAliases.has(String(error.code || ""))) return definitionForName(codeAliases.get(String(error.code)));
  if (status === 402 || /insufficient (funds|balance|credits)|credit balance|out of credits|quota.*billing/.test(text)) {
    if (/replicate/.test(provider + text) || /billing|required payment|payment required/.test(text)) return definitionForName("PROVIDER_BILLING_REQUIRED");
    return definitionForName(context.system === "ledger" ? "USER_INSUFFICIENT_CREDITS" : "PROVIDER_NO_CREDITS");
  }
  if (status === 401 || /invalid api key|unauthorized|authentication failed|invalid token/.test(text)) return definitionForName(context.provider ? "PROVIDER_AUTH_FAILED" : "INVALID_API_CREDENTIALS");
  if (status === 403 || /forbidden|permission denied|not authorized/.test(text)) {
    if (/model|provider/.test(text) && context.provider) return definitionForName("MODEL_ACCESS_DENIED");
    return definitionForName("PERMISSION_DENIED");
  }
  if (status === 404 && /model|endpoint|deployment/.test(text)) return definitionForName("MODEL_NOT_FOUND");
  if (/model.*(not available|unavailable)|temporarily disabled/.test(text)) return definitionForName("MODEL_NOT_AVAILABLE");
  if (/unsupported.*(parameter|setting)|parameter.*unsupported|invalid parameter/.test(text)) return definitionForName("MODEL_PARAMETER_UNSUPPORTED");
  if (status === 429 || /rate.?limit|too many requests|daily quota|throttl/.test(text)) return definitionForName("PROVIDER_RATE_LIMIT");
  if (/provider busy|capacity|overloaded|high demand|try again later/.test(text)) return definitionForName("PROVIDER_BUSY");
  if (/timeout|timed out|aborterror/.test(text)) return definitionForName(context.provider ? "PROVIDER_TIMEOUT" : "NETWORK_TIMEOUT");
  if (/enotfound|dns/.test(text)) return definitionForName("DNS_ERROR");
  if (/econnrefused|econnreset|connection refused|socket hang up/.test(text)) return definitionForName("CONNECTION_FAILED");
  if (/certificate|tls|ssl/.test(text)) return definitionForName("TLS_ERROR");
  if (/ffprobe.*(not found|enoent|unavailable)/.test(text)) return definitionForName("FFPROBE_NOT_AVAILABLE");
  if (/ffmpeg.*(not found|enoent|unavailable)/.test(text)) return definitionForName("FFMPEG_NOT_AVAILABLE");
  if (/frame.*extract/.test(text)) return definitionForName("FRAME_EXTRACTION_FAILED");
  if (/transcod|codec conversion/.test(text)) return definitionForName("TRANSCODING_FAILED");
  if (/unsupported codec|codec.*unsupported/.test(text)) return definitionForName("UNSUPPORTED_CODEC");
  if (/file too large|payload too large|413/.test(text)) return definitionForName("FILE_TOO_LARGE");
  if (/unsupported (format|mime)|invalid mime/.test(text)) return definitionForName("UNSUPPORTED_FORMAT");
  if (/corrupt|unreadable|invalid signature/.test(text)) return definitionForName("CORRUPTED_FILE");
  if (/invalid.*duration|duration.*(limit|range)/.test(text)) return definitionForName("INVALID_DURATION");
  if (/invalid.*resolution|resolution.*unsupported/.test(text)) return definitionForName("INVALID_RESOLUTION");
  if (/invalid.*fps|frame rate/.test(text)) return definitionForName("INVALID_FPS");
  if (/prompt.*(blocked|moderation)|content policy/.test(text)) return definitionForName("PROMPT_BLOCKED");
  if (/output.*blocked/.test(text)) return definitionForName("OUTPUT_BLOCKED");
  if (/signed upload/.test(text)) return definitionForName("SIGNED_UPLOAD_FAILED");
  if (/provider.*upload|ephemeral upload/.test(text)) return definitionForName("PROVIDER_UPLOAD_FAILED");
  if (/upload/.test(text)) return definitionForName("UPLOAD_FAILED");
  if (/temporary.*url.*expired|url.*expired/.test(text)) return definitionForName("TEMPORARY_URL_EXPIRED");
  if (/storage.*(write|persist|save)|asset_storage/.test(text)) return definitionForName("STORAGE_WRITE_FAILED");
  if (/storage.*read|asset.*not found/.test(text)) return definitionForName("STORAGE_READ_FAILED");
  if (/constraint|duplicate key|foreign key|23505|23503/.test(text)) return definitionForName("DATABASE_CONSTRAINT_ERROR");
  if (/tenant/.test(text) && /missing|invalid|ownership|inconsistent/.test(text)) return definitionForName("TENANT_DATA_ERROR");
  if (/database.*unavailable|postgres.*unavailable|57p01|0800/.test(text)) return definitionForName("DATABASE_UNAVAILABLE");
  if (/transaction|rollback|deadlock|40p01/.test(text)) return definitionForName("TRANSACTION_FAILED");
  if (/database|postgres|sql|query/.test(text)) return definitionForName("DATABASE_QUERY_FAILED");
  if (/invalid prompt|prompt.*required|empty prompt/.test(text)) return definitionForName("INVALID_PROMPT");
  if (/reference.*(missing|invalid|required)/.test(text)) return definitionForName("INVALID_REFERENCE");
  if (/invalid response|missing output|malformed response/.test(text)) return definitionForName("PROVIDER_INVALID_RESPONSE");
  if (/generation.*failed|provider.*failed|prediction.*failed/.test(text)) return definitionForName("PROVIDER_GENERATION_FAILED");
  if (context.provider || status >= 500) return definitionForName("PROVIDER_REQUEST_FAILED");
  return definitionForName(context.jobId ? "UNKNOWN_JOB_ERROR" : "INTERNAL_SLT_ERROR");
}

export function classifySltError(error = {}, context = {}) {
  const requested = String(error.sltCode || error.errorCode || "");
  const definition = SLT_ERROR_REGISTRY[requested] || SLT_ERROR_BY_NAME[requested] || classifyByText(error, context);
  return {
    ...definition,
    retryable: typeof error.retryable === "boolean" ? error.retryable : definition.retryable,
    compensationEligible: typeof error.compensationEligible === "boolean"
      ? error.compensationEligible
      : definition.compensationEligible
  };
}

export function createIncidentId(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `ERR-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function sanitizeDiagnosticText(value = "", { maxLength = 1200 } = {}) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  text = text
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|pk|rk|whsec|eyJ)[-_a-z0-9.]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(?:postgres(?:ql)?|mysql):\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]")
    .replace(/\/(?:Users|home|var|private|opt|srv)\/[^\s"']+/g, "[PATH_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

export function publicErrorPayload({ classification, incident = null, coupon = null, credits = null } = {}) {
  const definition = classification || SLT_ERROR_BY_NAME.INTERNAL_SLT_ERROR;
  return {
    errorCode: definition.code,
    errorName: definition.name,
    category: definition.category,
    incidentId: incident?.incidentId || incident?.id || null,
    customerMessage: definition.customerMessage,
    retryable: Boolean(definition.retryable),
    reservationReleased: Boolean(incident?.reservationReleased),
    creditsReturned: Boolean(incident?.reservationReleased),
    credits: credits || null,
    compensation: coupon ? {
      code: coupon.code,
      discountPercent: coupon.discountPercent,
      expiresAt: coupon.expiresAt,
      status: coupon.status
    } : null
  };
}

export function registrySummary() {
  return {
    count: Object.keys(SLT_ERROR_REGISTRY).length,
    categories: Object.values(SLT_ERROR_REGISTRY).reduce((counts, item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
      return counts;
    }, {})
  };
}
