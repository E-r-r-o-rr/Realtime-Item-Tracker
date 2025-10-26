import { randomUUID } from "crypto";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import {
  KeyValuePair,
  VlmSettings,
  VlmRemoteSettings,
  VlmMode,
  VlmAuthScheme,
  VlmProviderType,
  VlmRetryStrategy,
  VlmResponseFormat,
  VlmPromptLoggingLevel,
  VlmResponsePersistence,
  VlmToolInvocationPolicy,
  VlmCorsMode,
  VlmChunkingStrategy,
  VlmImageHandlingMode,
} from "@/types/vlm";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const toNumber = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "string" ? Number(value) : value;
  return isNumber(numeric) ? numeric : fallback;
};

const toString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
};

const normalizeArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toString(entry).trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const normalizeHeaders = (value: unknown): KeyValuePair[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const key = toString((entry as any).key).trim();
      const val = toString((entry as any).value).trim();
      const id = toString((entry as any).id) || randomUUID();
      if (!key && !val) return null;
      return { id, key, value: val };
    })
    .filter((entry): entry is KeyValuePair => entry !== null);
};

const normalizeEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return isNumber(numeric) ? numeric : null;
};

const normalizeRemoteSettings = (value: unknown): VlmRemoteSettings => {
  const base = structuredClone(DEFAULT_VLM_SETTINGS.remote);
  const incoming = (value && typeof value === "object" ? value : {}) as any;

  base.providerType = normalizeEnum<VlmProviderType>(
    incoming.providerType,
    ["openai-compatible", "anthropic-compatible", "huggingface", "azure-openai", "generic-http"] as const,
    base.providerType,
  );
  base.baseUrl = toString(incoming.baseUrl, base.baseUrl).trim();
  base.modelId = toString(incoming.modelId, base.modelId).trim();
  base.apiVersion = toString(incoming.apiVersion, base.apiVersion).trim();
  base.authScheme = normalizeEnum<VlmAuthScheme>(
    incoming.authScheme,
    ["bearer", "basic", "api-key-header", "none"] as const,
    base.authScheme,
  );
  base.authHeaderName = toString(incoming.authHeaderName, base.authHeaderName).trim() || "Authorization";
  base.apiKey = toString(incoming.apiKey, base.apiKey);
  base.extraHeaders = normalizeHeaders(incoming.extraHeaders);
  base.requestTimeoutMs = Math.max(0, toNumber(incoming.requestTimeoutMs, base.requestTimeoutMs));
  base.proxyUrl = toString(incoming.proxyUrl, base.proxyUrl).trim();
  base.corsMode = normalizeEnum<VlmCorsMode>(incoming.corsMode, ["cors", "no-cors", "same-origin"] as const, base.corsMode);
  base.healthCheckPath = toString(incoming.healthCheckPath, base.healthCheckPath).trim();

  base.capabilities = {
    ...base.capabilities,
    chat: Boolean(incoming.capabilities?.chat ?? base.capabilities.chat),
    textGeneration: Boolean(incoming.capabilities?.textGeneration ?? base.capabilities.textGeneration),
    embeddings: Boolean(incoming.capabilities?.embeddings ?? base.capabilities.embeddings),
    vision: Boolean(incoming.capabilities?.vision ?? base.capabilities.vision),
    functionCalling: Boolean(incoming.capabilities?.functionCalling ?? base.capabilities.functionCalling),
    streamingSupport: Boolean(incoming.capabilities?.streamingSupport ?? base.capabilities.streamingSupport),
    batching: Boolean(incoming.capabilities?.batching ?? base.capabilities.batching),
    responseFormat: normalizeEnum<VlmResponseFormat>(
      incoming.capabilities?.responseFormat,
      ["text", "json", "json-schema"] as const,
      base.capabilities.responseFormat,
    ),
    maxContextTokens: Math.max(
      0,
      toNumber(incoming.capabilities?.maxContextTokens, base.capabilities.maxContextTokens),
    ),
  };

  base.defaults = {
    ...base.defaults,
    systemPrompt: toString(incoming.defaults?.systemPrompt, base.defaults.systemPrompt),
    temperature: Math.max(0, toNumber(incoming.defaults?.temperature, base.defaults.temperature)),
    topP: Math.max(0, toNumber(incoming.defaults?.topP, base.defaults.topP)),
    topK: Math.max(0, toNumber(incoming.defaults?.topK, base.defaults.topK)),
    repetitionPenalty: Math.max(0, toNumber(incoming.defaults?.repetitionPenalty, base.defaults.repetitionPenalty)),
    stopSequences: normalizeArray(incoming.defaults?.stopSequences),
    maxOutputTokens: Math.max(1, toNumber(incoming.defaults?.maxOutputTokens, base.defaults.maxOutputTokens)),
    seed: toNullableNumber(incoming.defaults?.seed),
    streaming: Boolean(incoming.defaults?.streaming ?? base.defaults.streaming),
    jsonMode: Boolean(incoming.defaults?.jsonMode ?? base.defaults.jsonMode),
    toolInvocation: normalizeEnum<VlmToolInvocationPolicy>(
      incoming.defaults?.toolInvocation,
      ["auto", "none", "required"] as const,
      base.defaults.toolInvocation,
    ),
    jsonSchema: toString(incoming.defaults?.jsonSchema, base.defaults.jsonSchema),
  };

  base.rateLimits = {
    rpm: toNullableNumber(incoming.rateLimits?.rpm),
    tpm: toNullableNumber(incoming.rateLimits?.tpm),
    concurrency: toNullableNumber(incoming.rateLimits?.concurrency),
  };

  base.retryPolicy = {
    maxRetries: Math.max(0, toNumber(incoming.retryPolicy?.maxRetries, base.retryPolicy.maxRetries)),
    strategy: normalizeEnum<VlmRetryStrategy>(
      incoming.retryPolicy?.strategy,
      ["none", "linear", "exponential"] as const,
      base.retryPolicy.strategy,
    ),
    initialDelayMs: Math.max(0, toNumber(incoming.retryPolicy?.initialDelayMs, base.retryPolicy.initialDelayMs)),
  };

  base.circuitBreaker = {
    failureThreshold: Math.max(0, toNumber(incoming.circuitBreaker?.failureThreshold, base.circuitBreaker.failureThreshold)),
    windowSeconds: Math.max(0, toNumber(incoming.circuitBreaker?.windowSeconds, base.circuitBreaker.windowSeconds)),
    resetSeconds: Math.max(0, toNumber(incoming.circuitBreaker?.resetSeconds, base.circuitBreaker.resetSeconds)),
  };

  base.parameterMapping = {
    ...base.parameterMapping,
    bodyTemplate: toString(incoming.parameterMapping?.bodyTemplate, base.parameterMapping.bodyTemplate),
    responseTextPath: toString(incoming.parameterMapping?.responseTextPath, base.parameterMapping.responseTextPath),
    promptTokensPath: toString(incoming.parameterMapping?.promptTokensPath, base.parameterMapping.promptTokensPath),
    completionTokensPath: toString(
      incoming.parameterMapping?.completionTokensPath,
      base.parameterMapping.completionTokensPath,
    ),
    totalTokensPath: toString(incoming.parameterMapping?.totalTokensPath, base.parameterMapping.totalTokensPath),
    finishReasonPath: toString(incoming.parameterMapping?.finishReasonPath, base.parameterMapping.finishReasonPath),
    toolCallPath: toString(incoming.parameterMapping?.toolCallPath, base.parameterMapping.toolCallPath),
  };

  base.logging = {
    ...base.logging,
    promptLogging: normalizeEnum<VlmPromptLoggingLevel>(
      incoming.logging?.promptLogging,
      ["off", "redacted", "full"] as const,
      base.logging.promptLogging,
    ),
    piiRedaction: Boolean(incoming.logging?.piiRedaction ?? base.logging.piiRedaction),
    persistResponses: normalizeEnum<VlmResponsePersistence>(
      incoming.logging?.persistResponses,
      ["never", "1h", "24h", "7d"] as const,
      base.logging.persistResponses,
    ),
    dataResidencyNote: toString(incoming.logging?.dataResidencyNote, base.logging.dataResidencyNote),
    costTracking: {
      inputPrice: Math.max(0, toNumber(incoming.logging?.costTracking?.inputPrice, base.logging.costTracking.inputPrice)),
      outputPrice: Math.max(0, toNumber(incoming.logging?.costTracking?.outputPrice, base.logging.costTracking.outputPrice)),
      currency: toString(incoming.logging?.costTracking?.currency, base.logging.costTracking.currency).toUpperCase(),
    },
  };

  base.ocr = {
    ...base.ocr,
    inputLimitChars: Math.max(1, toNumber(incoming.ocr?.inputLimitChars, base.ocr.inputLimitChars)),
    chunkingStrategy: normalizeEnum<VlmChunkingStrategy>(
      incoming.ocr?.chunkingStrategy,
      ["tokens", "sentences"] as const,
      base.ocr.chunkingStrategy,
    ),
    imageHandling: normalizeEnum<VlmImageHandlingMode>(
      incoming.ocr?.imageHandling,
      ["upload", "url", "base64"] as const,
      base.ocr.imageHandling,
    ),
    maxImageSizeMb: Math.max(1, toNumber(incoming.ocr?.maxImageSizeMb, base.ocr.maxImageSizeMb)),
    allowedImageFormats: toString(incoming.ocr?.allowedImageFormats, base.ocr.allowedImageFormats),
    layoutJsonExpected: Boolean(incoming.ocr?.layoutJsonExpected ?? base.ocr.layoutJsonExpected),
    postProcessingTemplate: toString(incoming.ocr?.postProcessingTemplate, base.ocr.postProcessingTemplate),
  };

  return base;
};

export const normalizeVlmSettings = (value: unknown): VlmSettings => {
  const base = structuredClone(DEFAULT_VLM_SETTINGS);
  const incoming = (value && typeof value === "object" ? value : {}) as any;
  const mode = normalizeEnum<VlmMode>(incoming.mode, ["local", "remote"] as const, base.mode);
  return {
    mode,
    remote: normalizeRemoteSettings(incoming.remote),
  };
};
