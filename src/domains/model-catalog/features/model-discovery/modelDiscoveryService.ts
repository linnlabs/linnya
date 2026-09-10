/**
 * @file modelDiscoveryService.ts
 * @description 后端模型自动探测服务。
 * 针对 Custom API（OpenAI-compatible, OpenAI responses, Anthropic-compatible）或通用网关，
 * 通过探测其原生 /models 端点获取可用模型列表，并解析/推断其上下文窗口、最大输出 token 和视觉能力。
 */

import type {
  DiscoveredModel,
  ModelDiscoveryRequest,
  ModelDiscoveryResponse,
} from '@app/schemas';
import { inferModelCapabilitiesById } from '../catalog-admission/functions/inferModelCapabilitiesById';

const DEFAULT_TIMEOUT_MS = 15000;
const ANTHROPIC_VERSION = '2023-06-01';

export class ModelDiscoveryError extends Error {
  readonly code:
    | 'model_discovery.invalid_request'
    | 'model_discovery.network_error'
    | 'model_discovery.auth_failed'
    | 'model_discovery.unsupported_protocol'
    | 'model_discovery.failed';
  readonly statusCode: number;

  constructor(
    code:
      | 'model_discovery.invalid_request'
      | 'model_discovery.network_error'
      | 'model_discovery.auth_failed'
      | 'model_discovery.unsupported_protocol'
      | 'model_discovery.failed',
    message: string,
    statusCode: number = 500,
  ) {
    super(message);
    this.name = 'ModelDiscoveryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 构建特定协议的模型列表查询 URL
 */
export function buildDiscoveryUrl(baseUrl: string, apiFormat: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  if (apiFormat === 'anthropic_compatible') {
    const root = cleanBase.endsWith('/v1') ? cleanBase.slice(0, -3) : cleanBase;
    return `${root}/v1/models?limit=1000`;
  }
  // openai_compatible & openai_responses 默认请求 /models
  // 若用户填写的已经是 .../models，则不重复追加
  if (cleanBase.endsWith('/models')) {
    return cleanBase;
  }
  return `${cleanBase}/models`;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

interface RawListingEntry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  contextWindow?: unknown;
  max_input_tokens?: unknown;
  max_tokens?: unknown;
  max_output_tokens?: unknown;
  maxOutputTokens?: unknown;
  limit?: { context?: unknown; output?: unknown } | null;
  top_provider?: { max_completion_tokens?: unknown; context_length?: unknown } | null;
  supports_image_input?: unknown;
  multimodal?: unknown;
  architecture?: { modality?: unknown } | null;
}

/**
 * 解析响应中的模型数据
 */
export function parseModelListingResponse(body: unknown): DiscoveredModel[] {
  let entries: RawListingEntry[] = [];

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      // 标准 OpenAI 格式: { data: [{ id, ... }] }
      entries = record.data.filter((item): item is RawListingEntry => item && typeof item === 'object');
    } else if (Array.isArray(record.models)) {
      // 某些兼容网关: { models: [{ id, ... }] }
      entries = record.models.filter((item): item is RawListingEntry => item && typeof item === 'object');
    } else if (record.models && typeof record.models === 'object' && !Array.isArray(record.models)) {
      // OpenRouter / enriched map 格式: { models: { "id": { ... } } }
      entries = Object.entries(record.models as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([idKey, raw]) => ({ ...(raw as RawListingEntry), id: (raw as RawListingEntry).id ?? idKey }));
    }
  }

  const results: DiscoveredModel[] = [];

  for (const entry of entries) {
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : undefined;
    if (!rawId) continue;

    const rawName =
      (typeof entry.name === 'string' && entry.name.trim()) ||
      (typeof entry.display_name === 'string' && entry.display_name.trim()) ||
      (typeof entry.displayName === 'string' && entry.displayName.trim()) ||
      rawId;

    // 尝试读取提供方报告的容量
    const reportedContextWindow = positiveInteger(
      entry.context_window ??
      entry.contextWindow ??
      entry.context_length ??
      entry.max_input_tokens ??
      entry.limit?.context ??
      entry.top_provider?.context_length
    );

    const reportedMaxOutput = positiveInteger(
      entry.max_output_tokens ??
      entry.maxOutputTokens ??
      entry.max_tokens ??
      entry.limit?.output ??
      entry.top_provider?.max_completion_tokens
    );

    const reportedImageSupport =
      typeof entry.supports_image_input === 'boolean'
        ? entry.supports_image_input
        : typeof entry.multimodal === 'boolean'
        ? entry.multimodal
        : typeof entry.architecture?.modality === 'string' && entry.architecture.modality.includes('image')
        ? true
        : undefined;

    // 智能推断兜底
    const inferred = inferModelCapabilitiesById(rawId);

    const finalContextWindow = reportedContextWindow ?? inferred.context_window_tokens ?? 32768;
    const finalMaxOutput = reportedMaxOutput ?? inferred.max_output_tokens ?? 4096;
    const finalImageSupport = reportedImageSupport ?? inferred.supports_image_input ?? false;

    const confidence =
      reportedContextWindow !== undefined && reportedMaxOutput !== undefined
        ? 'reported'
        : inferred.context_window_tokens !== undefined
        ? 'inferred'
        : 'fallback';

    results.push({
      id: rawId,
      name: rawName,
      context_window_tokens: finalContextWindow,
      max_output_tokens: finalMaxOutput,
      supports_image_input: finalImageSupport,
      confidence,
    });
  }

  return results;
}

export interface ModelDiscoveryServiceOptions {
  readonly fetchFn?: typeof fetch;
}

export class ModelDiscoveryService {
  private readonly fetchFn: typeof fetch;

  constructor(options: ModelDiscoveryServiceOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async discover(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResponse> {
    const url = buildDiscoveryUrl(request.base_url, request.api_format);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (request.api_format === 'anthropic_compatible') {
      headers['anthropic-version'] = ANTHROPIC_VERSION;
      if (request.api_key) {
        headers['x-api-key'] = request.api_key;
      }
    } else if (request.api_key) {
      headers['Authorization'] = `Bearer ${request.api_key}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) {
        throw new ModelDiscoveryError(
          'model_discovery.network_error',
          `请求模型列表超时（${DEFAULT_TIMEOUT_MS / 1000}s）: ${url}`,
          504,
        );
      }
      throw new ModelDiscoveryError(
        'model_discovery.network_error',
        `无法连接到模型服务: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ModelDiscoveryError(
          'model_discovery.auth_failed',
          `端点鉴权失败 (${response.status})，请检查 API Key`,
          response.status,
        );
      }
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      throw new ModelDiscoveryError(
        'model_discovery.failed',
        `获取模型列表失败 (${response.status}): ${errorBody.slice(0, 200)}`,
        response.status,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err: unknown) {
      throw new ModelDiscoveryError(
        'model_discovery.failed',
        `解析模型列表响应失败: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    const models = parseModelListingResponse(data);
    return { models };
  }
}
