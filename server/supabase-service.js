import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function envValue(env, key) {
  return String(env[key] || "").trim();
}

function hasValue(env, key) {
  return Boolean(envValue(env, key));
}

function base64UrlDecode(value = "") {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function hmacBase64Url(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSupabaseAdminClient(env = process.env) {
  const url = envValue(env, "SUPABASE_URL");
  const serviceRoleKey = envValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function createSupabaseUserClient(env = process.env) {
  const url = envValue(env, "SUPABASE_URL");
  const anonKey = envValue(env, "SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function verifySupabaseJwt(token = "", env = process.env) {
  const rawToken = String(token || "").trim();
  const secret = envValue(env, "SUPABASE_JWT_SECRET") || envValue(env, "AUTH_JWT_SECRET");
  if (!rawToken || !secret) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = rawToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const signed = `${encodedHeader}.${encodedPayload}`;
  const expected = hmacBase64Url(signed, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(encodedSignature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
  if (header.alg !== "HS256") return null;

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSeconds) return null;
  if (payload.nbf && Number(payload.nbf) > nowSeconds) return null;

  const appMetadata = payload.app_metadata || {};
  const userMetadata = payload.user_metadata || {};
  const tenantId = appMetadata.tenant_id || userMetadata.tenant_id || payload.tenant_id || payload.sub;
  const role = appMetadata.role || userMetadata.role || payload.role || "authenticated";

  return {
    ok: true,
    mode: "supabase-jwt",
    userId: payload.sub,
    tenantId,
    role,
    email: payload.email || "",
    username: userMetadata.username || userMetadata.full_name || payload.email || payload.sub,
    token: rawToken,
    claims: payload,
    message: "Supabase JWT accepted."
  };
}

export function supabaseStorageConfigured(env = process.env) {
  return (
    envValue(env, "STORAGE_PROVIDER").toLowerCase() === "supabase" &&
    hasValue(env, "SUPABASE_URL") &&
    hasValue(env, "SUPABASE_SERVICE_ROLE_KEY") &&
    hasValue(env, "STORAGE_BUCKET")
  );
}

function safeStorageKey(value = "") {
  return String(value || "asset.bin").replace(/[^a-zA-Z0-9/_.,=-]/g, "_").replace(/_+/g, "_");
}

export function createSupabaseStorageService(env = process.env) {
  const client = createSupabaseAdminClient(env);
  const bucket = envValue(env, "STORAGE_BUCKET");
  const configured = Boolean(client && bucket && envValue(env, "STORAGE_PROVIDER").toLowerCase() === "supabase");

  return {
    kind: configured ? "supabase" : "local",
    durable: configured,
    configured,
    bucket,
    async upload({ key, bytes, contentType = "application/octet-stream", upsert = true }) {
      if (!configured) {
        const error = new Error("Supabase Storage is not configured.");
        error.code = "supabase_storage_not_configured";
        throw error;
      }
      const storageKey = safeStorageKey(key);
      const { error } = await client.storage.from(bucket).upload(storageKey, bytes, {
        contentType,
        upsert
      });
      if (error) {
        const uploadError = new Error(error.message || "Supabase Storage upload failed.");
        uploadError.code = "supabase_storage_upload_failed";
        throw uploadError;
      }
      const { data } = client.storage.from(bucket).getPublicUrl(storageKey);
      return {
        storageKey,
        publicUrl: data.publicUrl,
        provider: "supabase",
        bucket
      };
    },
    async remove(key) {
      if (!configured || !key) return { ok: false, skipped: true };
      const { error } = await client.storage.from(bucket).remove([key]);
      if (error) {
        const removeError = new Error(error.message || "Supabase Storage delete failed.");
        removeError.code = "supabase_storage_delete_failed";
        throw removeError;
      }
      return { ok: true };
    }
  };
}
