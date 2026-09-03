/**
 * @file src/agent/runtime-kernel/llm/modelCatalog.ts
 *
 * @description
 * Agent runtime 对“模型目录”的最小协议定义。
 * runtime-kernel 只依赖这些查询能力，不直接依赖 app 的 Model Catalog 实现。
 */

import type { ModelReasoningConfig } from './functions/reasoningEffort';
import type { AdapterInputSupport } from './input-capabilities';
import type { TokenRoute } from '../../contracts';

export interface ModelCatalogEntry {
  id: string;
  enabled?: boolean;
  api_key?: string;
  billing_mode?: 'byok' | 'cloud';
  /**
   * 是否允许客户端侧重试。
   *
   * 说明：
   * - runtime-kernel 会基于该字段与 billing_mode 决定重试策略；
   * - 该字段来自上层 Model Catalog（对齐 `src/domains/model-catalog/definitions/modelCatalog.ts`），避免在 runtime 侧出现类型漂移。
   */
  enable_client_retry?: boolean;
  model_name?: string;
  capabilities?: readonly string[];
  ui_visibility?: readonly string[];
  /** Host 根据显式 inference route/capability 解析出的输入 placement 支持。 */
  adapter_input_support?: AdapterInputSupport;
  /**
   * 思考努力程度能力契约。
   *
   * 说明：
   * - 来自上层 Model Catalog 的 `ModelConfig.reasoning`（宿主 `defaultModelCatalog` 透传完整 `ModelConfig`）；
   * - kernel 侧 `prepareCallStage` 用它 + 用户请求档位调 `resolveEffectiveEffort()` 做统一降级；
   * - 缺失表示该模型不支持 reasoning 控制，调用方不发任何思考相关字段。
   */
  reasoning?: ModelReasoningConfig;
  /** Chat route 的容量事实；fallback admission 只能读取正式 route。 */
  inference_route?: {
    context_window_tokens: number;
    max_output_tokens: number;
  };
  /** Host 已解析的 token accounting route。 */
  token_route?: TokenRoute;
}

export interface ModelCatalogLike {
  getModelById(id: string): ModelCatalogEntry | undefined;
  getModelsByCapability(capability: string): ModelCatalogEntry[];
  getModelsByUIVisibility(visibility: string): ModelCatalogEntry[];
}

export function createEmptyModelCatalog(): ModelCatalogLike {
  return {
    getModelById(): ModelCatalogEntry | undefined {
      return undefined;
    },
    getModelsByCapability(): ModelCatalogEntry[] {
      return [];
    },
    getModelsByUIVisibility(): ModelCatalogEntry[] {
      return [];
    },
  };
}

/**
 * 为已由调用方提供的外部聊天引擎建立最小 catalog。
 *
 * quickstart 的 canonical inference port 本身承诺该 ID 可聊天；但它没有 Host route profile，
 * 因此图片 placement 必须保持关闭，不能从“能聊天”推断“能识图”。
 */
export function createFixedChatModelCatalog(modelId: string): ModelCatalogLike {
  const entry: ModelCatalogEntry = Object.freeze({
    id: modelId,
    enabled: true,
    capabilities: Object.freeze(['chat']),
    adapter_input_support: Object.freeze({
      user_image: false,
      tool_result_image: false,
    }),
  });

  return {
    getModelById(id): ModelCatalogEntry | undefined {
      return id === modelId ? entry : undefined;
    },
    getModelsByCapability(capability): ModelCatalogEntry[] {
      return capability === 'chat' ? [entry] : [];
    },
    getModelsByUIVisibility(): ModelCatalogEntry[] {
      return [];
    },
  };
}
