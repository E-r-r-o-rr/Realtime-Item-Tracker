export type VlmMode = "local" | "remote";

export type VlmProviderType = "openai-compatible" | "huggingface" | "generic-http";

export type VlmAuthScheme = "bearer" | "basic" | "api-key-header" | "none";

export type VlmCorsMode = "cors" | "no-cors" | "same-origin";

export type VlmRetryStrategy = "none" | "linear" | "exponential";

export type VlmResponseFormat = "text" | "json" | "json-schema";

export type VlmPromptLoggingLevel = "off" | "redacted" | "full";

export type VlmResponsePersistence = "never" | "1h" | "24h" | "7d";

export type VlmChunkingStrategy = "tokens" | "sentences";

export type VlmImageHandlingMode = "upload" | "url" | "base64";

export type VlmToolInvocationPolicy = "auto" | "none" | "required";

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

export interface VlmCapabilityConfig {
  chat: boolean;
  textGeneration: boolean;
  embeddings: boolean;
  vision: boolean;
  functionCalling: boolean;
  streamingSupport: boolean;
  batching: boolean;
  responseFormat: VlmResponseFormat;
  maxContextTokens: number;
}

export interface VlmInferenceDefaults {
  systemPrompt: string;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  stopSequences: string[];
  maxOutputTokens: number;
  seed: number | null;
  streaming: boolean;
  jsonMode: boolean;
  toolInvocation: VlmToolInvocationPolicy;
  jsonSchema: string;
}

export interface VlmRateLimitConfig {
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null;
}

export interface VlmRetryPolicy {
  maxRetries: number;
  strategy: VlmRetryStrategy;
  initialDelayMs: number;
}

export interface VlmCircuitBreakerConfig {
  failureThreshold: number;
  windowSeconds: number;
  resetSeconds: number;
}

export interface VlmParameterMapping {
  bodyTemplate: string;
  responseTextPath: string;
  promptTokensPath: string;
  completionTokensPath: string;
  totalTokensPath: string;
  finishReasonPath: string;
  toolCallPath: string;
}

export interface VlmCostTrackingConfig {
  inputPrice: number;
  outputPrice: number;
  currency: string;
}

export interface VlmLocalSettings {
  modelId: string;
}

export interface VlmLoggingConfig {
  promptLogging: VlmPromptLoggingLevel;
  piiRedaction: boolean;
  persistResponses: VlmResponsePersistence;
  dataResidencyNote: string;
  costTracking: VlmCostTrackingConfig;
}

export interface VlmOcrTuning {
  inputLimitChars: number;
  chunkingStrategy: VlmChunkingStrategy;
  imageHandling: VlmImageHandlingMode;
  maxImageSizeMb: number;
  allowedImageFormats: string;
  layoutJsonExpected: boolean;
  postProcessingTemplate: string;
}

export interface VlmRemoteSettings {
  providerType: VlmProviderType;
  baseUrl: string;
  modelId: string;
  apiVersion: string;
  hfProvider: string;
  authScheme: VlmAuthScheme;
  authHeaderName: string;
  apiKey: string;
  extraHeaders: KeyValuePair[];
  requestTimeoutMs: number;
  proxyUrl: string;
  corsMode: VlmCorsMode;
  healthCheckPath: string;
  capabilities: VlmCapabilityConfig;
  defaults: VlmInferenceDefaults;
  rateLimits: VlmRateLimitConfig;
  retryPolicy: VlmRetryPolicy;
  circuitBreaker: VlmCircuitBreakerConfig;
  parameterMapping: VlmParameterMapping;
  logging: VlmLoggingConfig;
  ocr: VlmOcrTuning;
}

export interface VlmSettings {
  mode: VlmMode;
  local: VlmLocalSettings;
  remote: VlmRemoteSettings;
}
