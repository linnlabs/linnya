/**
 * @file src/domains/model-catalog/features/cloud-catalog/orchestration/fetchCloudModels.ts
 *
 * @description
 * 从 Linnya Cloud 拉取可用模型列表，并转换为本地 ModelConfig 格式。
 *
 * 设计要点：
 * - 启动时调用，带超时控制，失败不阻塞启动
 * - 云端模型声明 `catalog_source: cloud`，与内置目录和用户目录显式区分
 * - 通过 billing_mode: "cloud" 区分云端模型与本地内置模型
 * - 请求认证材料由 Host auth boundary 按 attempt 解析，不进入公开目录快照
 */

import type {
  ModelConfig,
  ModelEmbeddingRoute,
  ModelImageGenerationRoute,
  ModelInferenceRoute,
  ModelRerankingRoute,
  DocumentOcrRoute,
} from '../../../definitions/modelCatalog';
import type { CloudModelsFetchResult } from '../definitions/cloudCatalog';
import { readDocumentOcrRoute } from '../../catalog-admission/functions/readDocumentOcrRoute';
import { readModelEmbeddingRoute } from '../../catalog-admission/functions/readModelEmbeddingRoute';
import { readModelInferenceRoute } from '../../catalog-admission/functions/readModelInferenceRoute';
import { readModelImageGenerationRoute } from '../../catalog-admission/functions/readModelImageGenerationRoute';
import { readModelRerankingRoute } from '../../catalog-admission/functions/readModelRerankingRoute';
import { Logger } from 'src/shared/logger';
import { toCloudModelId } from '../functions/cloudModelIds';

const logger = new Logger('CloudModels');

/** 云端 API 基础地址 */
const CLOUD_API_BASE = 'https://api.linnyai.com';

/** 拉取模型列表的超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 8000;

/** 云端 /v1/models 响应中的单个模型 */
interface CloudModelItem {
  id: string;
  client_base_url: string;
  display_name?: string;
  capabilities?: string[];
  tags?: string[];
  client_inference_route?: ModelInferenceRoute;
  client_embedding_route?: ModelEmbeddingRoute;
  client_reranking_route?: ModelRerankingRoute;
  client_image_generation_route?: ModelImageGenerationRoute;
  client_document_ocr_route?: DocumentOcrRoute;
  limits: {
    daily: number;
    monthly: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isLinnyaCloudClientBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === CLOUD_API_BASE && url.pathname.startsWith('/proxy/');
  } catch {
    return false;
  }
}

function assertLinnyaCloudRouteIdentity(
  route: { readonly endpoint_id: string; readonly base_url: string } | undefined,
  clientBaseUrl: string
): void {
  if (route && route.endpoint_id !== 'linnya-cloud') {
    throw new Error('Cloud client route endpoint_id 必须是 linnya-cloud');
  }
  if (route && route.base_url !== clientBaseUrl) {
    throw new Error('Cloud client route base_url 必须与 client_base_url 一致');
  }
}

function isCloudModelItem(value: unknown): value is CloudModelItem {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.client_base_url !== 'string' ||
    !isLinnyaCloudClientBaseUrl(value.client_base_url)
  ) {
    return false;
  }
  if (
    !isRecord(value.limits) ||
    typeof value.limits.daily !== 'number' ||
    !Number.isFinite(value.limits.daily) ||
    typeof value.limits.monthly !== 'number' ||
    !Number.isFinite(value.limits.monthly)
  ) {
    return false;
  }
  if (value.display_name !== undefined && typeof value.display_name !== 'string') return false;
  if (value.capabilities !== undefined && !isStringArray(value.capabilities)) return false;
  if (value.tags !== undefined && !isStringArray(value.tags)) return false;
  const capabilities = value.capabilities ?? ['chat'];
  try {
    const inferenceRoute = readModelInferenceRoute(value.client_inference_route, {
      modelName: value.id,
      hasChatCapability: capabilities.includes('chat'),
    });
    const embeddingRoute = readModelEmbeddingRoute(value.client_embedding_route, {
      modelName: value.id,
      hasEmbeddingCapability: capabilities.includes('embedding'),
    });
    const rerankingRoute = readModelRerankingRoute(value.client_reranking_route, {
      modelName: value.id,
      hasRerankCapability: capabilities.includes('rerank'),
    });
    const imageGenerationRoute = readModelImageGenerationRoute(
      value.client_image_generation_route,
      {
        modelName: value.id,
        hasImageGenerationCapability: capabilities.includes('image_generation'),
      }
    );
    const documentOcrRoute = readDocumentOcrRoute(value.client_document_ocr_route, {
      modelName: value.id,
      hasDocumentOcrCapability: capabilities.includes('document_ocr'),
    });
    assertLinnyaCloudRouteIdentity(inferenceRoute, value.client_base_url);
    assertLinnyaCloudRouteIdentity(embeddingRoute, value.client_base_url);
    assertLinnyaCloudRouteIdentity(rerankingRoute, value.client_base_url);
    assertLinnyaCloudRouteIdentity(imageGenerationRoute, value.client_base_url);
    assertLinnyaCloudRouteIdentity(documentOcrRoute, value.client_base_url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 Linnya Cloud 拉取可用模型列表并转换为 ModelConfig[]。
 * 失败时返回显式失败结果，不抛异常。
 */
export async function fetchCloudModels(): Promise<CloudModelsFetchResult> {
  let data: unknown;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    logger.info(`开始拉取云端模型列表: ${CLOUD_API_BASE}/v1/models`);

    const response = await fetch(`${CLOUD_API_BASE}/v1/models`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(`云端模型列表请求失败: ${response.status} ${response.statusText}`);
      return {
        success: false,
        models: [],
        purposeDefaults: {},
        failureReason: 'http_error',
      };
    }

    data = await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('云端模型列表请求超时');
      return {
        success: false,
        models: [],
        purposeDefaults: {},
        failureReason: 'timeout',
      };
    } else {
      logger.warn('云端模型列表请求异常:', err);
      return {
        success: false,
        models: [],
        purposeDefaults: {},
        failureReason: 'network_error',
      };
    }
  } finally {
    clearTimeout(timer);
  }

  if (!isRecord(data) || !Array.isArray(data.models)) {
    logger.warn('云端模型列表响应格式异常');
    return {
      success: false,
      models: [],
      purposeDefaults: {},
      failureReason: 'invalid_payload',
    };
  }

  const validItems = data.models.filter(isCloudModelItem);
  if (data.models.length > 0 && validItems.length === 0) {
    logger.warn('云端模型列表没有可用的合法条目');
    return {
      success: false,
      models: [],
      purposeDefaults: {},
      failureReason: 'invalid_payload',
    };
  }
  if (validItems.length !== data.models.length) {
    logger.warn(`云端模型列表已忽略 ${data.models.length - validItems.length} 条非法配置`);
  }

  const models: ModelConfig[] = validItems.map(item => {
    const capabilities = item.capabilities ?? ['chat'];
    const clientBaseUrl = item.client_base_url;
    const inferenceRoute = readModelInferenceRoute(item.client_inference_route, {
      modelName: item.id,
      hasChatCapability: capabilities.includes('chat'),
    });
    const embeddingRoute = readModelEmbeddingRoute(item.client_embedding_route, {
      modelName: item.id,
      hasEmbeddingCapability: capabilities.includes('embedding'),
    });
    const rerankingRoute = readModelRerankingRoute(item.client_reranking_route, {
      modelName: item.id,
      hasRerankCapability: capabilities.includes('rerank'),
    });
    const imageGenerationRoute = readModelImageGenerationRoute(item.client_image_generation_route, {
      modelName: item.id,
      hasImageGenerationCapability: capabilities.includes('image_generation'),
    });
    const documentOcrRoute = readDocumentOcrRoute(item.client_document_ocr_route, {
      modelName: item.id,
      hasDocumentOcrCapability: capabilities.includes('document_ocr'),
    });
    const config: ModelConfig = {
      id: toCloudModelId(item.id),
      model_name: item.id,
      catalog_source: 'cloud',
      credential_reference: { kind: 'host_managed', credential_id: 'linnya-cloud' },
      capabilities,
      ui_visibility: capabilities,
      display_name: item.display_name || item.id,
      description: `Linnya Cloud · 每日 ${item.limits.daily} 次 · 每月 ${item.limits.monthly} 次`,
      billing_mode: 'cloud',
      enable_client_retry: false,
      inference_route: inferenceRoute,
      embedding_route: embeddingRoute,
      reranking_route: rerankingRoute,
      image_generation_route: imageGenerationRoute,
      document_ocr_route: documentOcrRoute,
      token_route: {
        capabilityId: inferenceRoute?.capability_id ?? 'host:linnya-cloud-token-accounting',
        baseURL: inferenceRoute?.base_url ?? clientBaseUrl,
        modelId: toCloudModelId(item.id),
        endpointModelId: item.id,
        capabilities: {
          supportsResponseUsage:
            inferenceRoute?.usage.response_usage === 'provider_reported_optional',
        },
      },
      tags: item.tags,
    };

    return config;
  });

  logger.info(`从云端加载了 ${models.length} 个模型`);
  const purposeDefaults = isRecord(data.task_defaults)
    ? Object.fromEntries(
        Object.entries(data.task_defaults)
          .filter((entry): entry is [string, string] => {
            const [purposeKey, modelName] = entry;
            return (
              purposeKey.trim().length > 0 &&
              typeof modelName === 'string' &&
              modelName.trim().length > 0
            );
          })
          .map(([purposeKey, modelName]) => [purposeKey, toCloudModelId(modelName.trim())])
      )
    : {};

  return {
    success: true,
    models,
    purposeDefaults,
  };
}
