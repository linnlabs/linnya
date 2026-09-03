import { createEmptyModelCatalog, type ModelCatalogLike } from './modelCatalog';
import {
  evaluateModelInputCompatibility,
  type ModelInputRequirement,
} from './input-capabilities';

export interface ModelResolverOptions {
  fallbackModelPreferredOrder?: readonly string[];
  modelCatalog?: ModelCatalogLike;
}

export interface ModelResolverLike {
  resolveModelId(requestedModelId?: string): string;
  pickFallbackChatModel(
    excludedModelIds: Set<string>,
    requirement: ModelInputRequirement,
  ): string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const getString = (obj: unknown, key: string): string | undefined => {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
};

const getBoolean = (obj: unknown, key: string): boolean | undefined => {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
};

/**
 * 模型解析职责单独收口，避免 caller / executor stage 混入 registry 选模细节。
 */
export class ModelResolver implements ModelResolverLike {
  private readonly fallbackModelPreferredOrder: readonly string[];
  private readonly modelCatalog: ModelCatalogLike;

  constructor(options: ModelResolverOptions = {}) {
    this.fallbackModelPreferredOrder = Array.isArray(options.fallbackModelPreferredOrder)
      ? options.fallbackModelPreferredOrder
      : [];
    this.modelCatalog = options.modelCatalog ?? createEmptyModelCatalog();
  }

  resolveModelId(requestedModelId?: string): string {
    return requestedModelId || this.getDefaultChatModel();
  }

  /**
   * 选模规则（严格、可解释）：
   * - “默认聊天模型”应来自主对话下拉（ui_visibility: 'chat'），而不是“任何具备 chat capability 的模型”。
   *
   * 根因说明：
   * - default_models.json 中存在 mock-chat（capabilities: ['chat']，但 ui_visibility 是 'chat1'）；
   * - 若按 capability='chat' 取第一个，会导致内部流程（如 deep_search 子 Agent）默认落到 mock 模型，
   *   从而无法产生 tool_calls / final_answer（只会 yield thought）。
   */
  private getDefaultChatModel(): string {
    const uiChatModels = this.modelCatalog.getModelsByUIVisibility('chat');
    const preferred = uiChatModels.filter((model) => getBoolean(model, 'enabled') !== false);
    if (preferred.length > 0) {
      return preferred[0].id;
    }

    const chatModels = this.modelCatalog.getModelsByCapability('chat');
    const fallback = chatModels.filter((model) => getBoolean(model, 'enabled') !== false);
    if (fallback.length === 0) {
      throw new Error('没有可用的聊天模型');
    }
    return fallback[0].id;
  }

  /**
   * 选择一个可用的“策略切模备用聊天模型”：
   * - 必须具备 chat 能力
   * - 必须已解析到 api_key（否则必然失败）
   * - Host 可通过 fallbackModelPreferredOrder 显式声明顺序；Linnkit 不解释 URL 或 Provider 名称
   */
  pickFallbackChatModel(
    excludedModelIds: Set<string>,
    requirement: ModelInputRequirement,
  ): string | null {
    const chatModels = this.modelCatalog.getModelsByCapability('chat') || [];

    const enabled = chatModels
      .filter((model) => getBoolean(model, 'enabled') !== false)
      .filter((model) => evaluateModelInputCompatibility(model, requirement).compatible)
      .filter((model) => {
        const key = getString(model, 'api_key');
        return typeof key === 'string' && key.length > 0;
      })
      .filter((model) => !excludedModelIds.has(model.id));

    if (enabled.length === 0) return null;

    for (const id of this.fallbackModelPreferredOrder) {
      const found = enabled.find((model) => model.id === id);
      if (found) return found.id;
    }

    return enabled[0].id;
  }
}
