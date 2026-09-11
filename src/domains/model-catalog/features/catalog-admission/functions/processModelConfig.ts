/**
 * @file src/domains/model-catalog/features/catalog-admission/functions/processModelConfig.ts
 *
 * @description
 * 负责将原始模型配置转换为 Model Catalog 内部使用的标准 ModelConfig。
 */

import type {
  ModelConfig,
  ModelTokenPricing,
  ModelTokenRoute,
  TokenRouteCapabilities,
} from '../../../definitions/modelCatalog';
import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import { isValidReasoningEffort, REASONING_EFFORTS } from '@linnlabs/linnkit/contracts';
import { inferReasoningConfigByModelName } from './inferReasoningConfigByModelName';
import { readModelInferenceRoute } from './readModelInferenceRoute';
import { readModelEmbeddingRoute } from './readModelEmbeddingRoute';
import { readModelRerankingRoute } from './readModelRerankingRoute';
import { readModelImageGenerationRoute } from './readModelImageGenerationRoute';
import { readDocumentOcrRoute } from './readDocumentOcrRoute';
import { readTranscriptionRoute } from './readTranscriptionRoute';
import { readCredentialReference } from '../../inference-endpoints/functions/readCredentialReference';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return normalized.length > 0 ? normalized : undefined;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readCatalogSource(value: unknown): ModelConfig['catalog_source'] {
  if (value === 'default' || value === 'cloud' || value === 'account' || value === 'user') {
    return value;
  }
  throw new Error("ModelConfig.catalog_source 必须是 'default'、'cloud'、'account' 或 'user'");
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readTokenRouteCapabilities(value: unknown): TokenRouteCapabilities | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const capabilities: TokenRouteCapabilities = {
    supportsRemoteTokenCount: readBoolean(raw.supportsRemoteTokenCount),
    supportsResponseUsage: readBoolean(raw.supportsResponseUsage),
    supportsCachedInputBilling: readBoolean(raw.supportsCachedInputBilling),
    supportsReasoningTokens: readBoolean(raw.supportsReasoningTokens),
  };

  return Object.values(capabilities).some(value => value !== undefined) ? capabilities : undefined;
}

function readTokenRoute(value: unknown): ModelTokenRoute | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const capabilityId = readString(raw.capabilityId).trim();
  const modelId = readString(raw.modelId).trim();
  if (!capabilityId || !modelId) {
    throw new Error(
      '[ModelConfigProcessor] token_route.capabilityId 与 token_route.modelId 必须为非空字符串。'
    );
  }

  const baseURL = readString(raw.baseURL).trim() || undefined;
  const endpointModelId = readString(raw.endpointModelId).trim() || undefined;
  const capabilities = readTokenRouteCapabilities(raw.capabilities);

  return {
    capabilityId,
    ...(baseURL ? { baseURL } : {}),
    modelId,
    ...(endpointModelId ? { endpointModelId } : {}),
    ...(capabilities ? { capabilities } : {}),
  };
}

function readTokenPricing(value: unknown): ModelTokenPricing | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const currency = raw.currency;
  const unit = raw.unit;
  if (currency !== 'USD') {
    throw new Error("[ModelConfigProcessor] token_pricing.currency 必须为 'USD'。");
  }
  if (unit !== 'per_1m_tokens') {
    throw new Error("[ModelConfigProcessor] token_pricing.unit 必须为 'per_1m_tokens'。");
  }

  const pricing: ModelTokenPricing = {
    currency,
    unit,
    input: readNonNegativeNumber(raw.input),
    output: readNonNegativeNumber(raw.output),
    reasoning: readNonNegativeNumber(raw.reasoning),
    cacheRead: readNonNegativeNumber(raw.cacheRead),
    cacheWrite: readNonNegativeNumber(raw.cacheWrite),
  };

  return pricing;
}

/**
 * 解析并校验 `reasoning` 能力契约。
 *
 * 校验规则：
 * - `supported_efforts`：过滤非法枚举值、去重，并按 `REASONING_EFFORTS` 顺序（从弱到强）归一化排序，
 *   保证降级兜底取首项（最弱档）的行为可预测；空数组视为不支持，返回 undefined（不保留字段）。
 * - `default_effort`：必须为合法枚举且在 supported 中，否则忽略。
 */
function readReasoningConfig(value: unknown): ModelReasoningConfig | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const rawEfforts = Array.isArray(raw.supported_efforts) ? raw.supported_efforts : [];
  const deduped = Array.from(new Set(rawEfforts.filter(isValidReasoningEffort)));
  if (deduped.length === 0) return undefined;
  // 按 REASONING_EFFORTS 顺序（从弱到强）归一化排序
  const supportedEfforts = deduped.sort(
    (a, b) => REASONING_EFFORTS.indexOf(a) - REASONING_EFFORTS.indexOf(b)
  );

  const rawDefaultEffort = raw.default_effort;
  const defaultEffort =
    isValidReasoningEffort(rawDefaultEffort) && supportedEfforts.includes(rawDefaultEffort)
      ? rawDefaultEffort
      : undefined;

  return {
    supported_efforts: supportedEfforts,
    default_effort: defaultEffort,
  };
}

export function processModelConfig(args: {
  modelData: unknown;
  envVars: Record<string, string>;
}): ModelConfig {
  const modelData = asRecord(args.modelData);
  if (!modelData) {
    throw new Error('Invalid model config: expected object');
  }

  const billingMode = (() => {
    const raw = modelData.billing_mode;
    if (raw === 'byok' || raw === 'cloud') return raw;
    return undefined;
  })();

  const enableClientRetry = (() => {
    const raw = modelData.enable_client_retry;
    return typeof raw === 'boolean' ? raw : undefined;
  })();

  const imageGeneration = (() => {
    const raw = asRecord(modelData.image_generation);
    if (!raw) return undefined;
    const minPixels = typeof raw.min_pixels === 'number' ? raw.min_pixels : undefined;
    const maxPixels = typeof raw.max_pixels === 'number' ? raw.max_pixels : undefined;
    const allowedSizes = Array.isArray(raw.allowed_sizes)
      ? raw.allowed_sizes.filter((value): value is string => typeof value === 'string')
      : undefined;
    return {
      min_pixels: minPixels,
      max_pixels: maxPixels,
      allowed_sizes: allowedSizes,
    };
  })();

  if ('api_key' in modelData || 'api_key_env_var' in modelData) {
    throw new Error(
      'ModelConfig 不再接受 api_key/api_key_env_var，请使用 credential_reference 或 inference_endpoint_id'
    );
  }
  const credentialReference = readCredentialReference(modelData.credential_reference);
  const inferenceEndpointId = readString(modelData.inference_endpoint_id).trim() || undefined;
  if (credentialReference && inferenceEndpointId) {
    throw new Error('ModelConfig 不能同时声明 credential_reference 与 inference_endpoint_id');
  }
  const capabilities = Array.isArray(modelData.capabilities)
    ? modelData.capabilities.filter((value): value is string => typeof value === 'string')
    : [];

  const inferenceRoute = readModelInferenceRoute(modelData.inference_route, {
    modelName: readString(modelData.model_name),
    hasChatCapability: capabilities.includes('chat'),
  });
  const embeddingRoute = readModelEmbeddingRoute(modelData.embedding_route, {
    modelName: readString(modelData.model_name),
    hasEmbeddingCapability: capabilities.includes('embedding'),
  });
  const rerankingRoute = readModelRerankingRoute(modelData.reranking_route, {
    modelName: readString(modelData.model_name),
    hasRerankCapability: capabilities.includes('rerank'),
  });
  const imageGenerationRoute = readModelImageGenerationRoute(modelData.image_generation_route, {
    modelName: readString(modelData.model_name),
    hasImageGenerationCapability: capabilities.includes('image_generation'),
  });
  const documentOcrRoute = readDocumentOcrRoute(modelData.document_ocr_route, {
    modelName: readString(modelData.model_name),
    hasDocumentOcrCapability: capabilities.includes('document_ocr'),
  });
  const transcriptionRoute = readTranscriptionRoute(modelData.transcription_route, {
    modelName: readString(modelData.model_name),
    hasAudioTranscriptionCapability: capabilities.includes('audio_transcription'),
  });

  const model: ModelConfig = {
    id: readString(modelData.id),
    model_name: readString(modelData.model_name),
    catalog_source: readCatalogSource(modelData.catalog_source),
    credential_reference: credentialReference,
    inference_endpoint_id: inferenceEndpointId,
    ...(typeof modelData.custom_provider_name === 'string' && modelData.custom_provider_name.trim().length > 0
      ? { custom_provider_name: modelData.custom_provider_name.trim() }
      : {}),
    capabilities,
    ui_visibility: Array.isArray(modelData.ui_visibility)
      ? modelData.ui_visibility.filter((value): value is string => typeof value === 'string')
      : [],
    display_name: readString(modelData.display_name),
    description: readString(modelData.description),
    inference_route: inferenceRoute,
    embedding_route: embeddingRoute,
    reranking_route: rerankingRoute,
    image_generation_route: imageGenerationRoute,
    document_ocr_route: documentOcrRoute,
    transcription_route: transcriptionRoute,
    billing_mode: billingMode,
    token_route: readTokenRoute(modelData.token_route),
    token_pricing: readTokenPricing(modelData.token_pricing),
    enable_client_retry: enableClientRetry,
    image_generation: imageGeneration,
    tags: asStringArray(modelData.tags),
    // 显式 reasoning 契约优先；未显式声明时按 model_name 推断常见 reasoning 模型能力（兜底）
    reasoning:
      readReasoningConfig(modelData.reasoning) ??
      inferReasoningConfigByModelName(readString(modelData.model_name)),
  };

  return model;
}
