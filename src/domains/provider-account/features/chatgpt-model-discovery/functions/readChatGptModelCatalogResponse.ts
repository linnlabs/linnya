import type { ChatGptAccountModel } from '../definitions/chatGptModelCatalog';
import { CHATGPT_MODEL_CATALOG_CONFIG } from '../definitions/chatGptModelCatalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`ChatGPT /models 的 ${field} 必须是非空字符串`);
  }
  return value.trim();
}

function readPositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`ChatGPT /models 的 ${field} 必须是正安全整数`);
  }
  return value;
}

function readSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`ChatGPT /models 的 ${field} 必须是安全整数`);
  }
  return value;
}

function readOptionalPositiveSafeInteger(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : readPositiveSafeInteger(value, field);
}

function readInputModalities(value: unknown): readonly string[] {
  if (value === undefined) return ['text', 'image'];
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error('ChatGPT /models 的 input_modalities 必须是字符串数组');
  }
  return value;
}

function readReasoningCapability(value: unknown): boolean {
  if (!Array.isArray(value)) {
    throw new Error('ChatGPT /models 的 supported_reasoning_levels 必须是数组');
  }
  return value.length > 0;
}

interface PrioritizedChatGptAccountModel {
  readonly priority: number;
  readonly model: ChatGptAccountModel;
}

function projectVisibleModel(value: unknown): PrioritizedChatGptAccountModel | undefined {
  if (!isRecord(value)) throw new Error('ChatGPT /models 包含非对象模型条目');
  const visibility = readNonEmptyString(value.visibility, 'visibility');
  if (visibility !== 'list' && visibility !== 'hide' && visibility !== 'none') {
    throw new Error(`ChatGPT /models 包含未知 visibility: ${visibility}`);
  }
  if (visibility !== 'list') return undefined;

  const id = readNonEmptyString(value.slug, 'slug');
  const contextWindow =
    readOptionalPositiveSafeInteger(value.context_window, `${id}.context_window`) ??
    readOptionalPositiveSafeInteger(value.max_context_window, `${id}.max_context_window`);
  if (contextWindow === undefined) {
    throw new Error(`ChatGPT /models 的 ${id} 缺少 context_window`);
  }
  const effectivePercent =
    value.effective_context_window_percent === undefined
      ? CHATGPT_MODEL_CATALOG_CONFIG.default_effective_context_window_percent
      : readPositiveSafeInteger(
          value.effective_context_window_percent,
          `${id}.effective_context_window_percent`
        );
  if (effectivePercent >= 100) {
    throw new Error(`ChatGPT /models 的 ${id} 没有为模型输出保留上下文空间`);
  }
  const maxInputTokens = Math.floor((contextWindow * effectivePercent) / 100);
  const maxOutputTokens = contextWindow - maxInputTokens;
  const inputModalities = readInputModalities(value.input_modalities);

  return {
    priority: readSafeInteger(value.priority, `${id}.priority`),
    model: {
      id,
      display_name: readNonEmptyString(value.display_name, `${id}.display_name`),
      context_window_tokens: contextWindow,
      max_input_tokens: maxInputTokens,
      // Codex /models 不声明独立输出上限；官方客户端用 effective percent 为输出保留 headroom。
      max_output_tokens: maxOutputTokens,
      capabilities: {
        image_input: inputModalities.includes('image'),
        tool_call: true,
        reasoning: readReasoningCapability(value.supported_reasoning_levels),
      },
    },
  };
}

/** 读取官方 Codex `/models` 账户目录，只投影当前账号在 picker 中可见的模型。 */
export function readChatGptModelCatalogResponse(value: unknown): readonly ChatGptAccountModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new Error('ChatGPT /models 响应必须包含 models 数组');
  }

  const models = value.models
    .map(projectVisibleModel)
    .filter((model): model is PrioritizedChatGptAccountModel => model !== undefined)
    .sort((left, right) => left.priority - right.priority)
    .map(entry => entry.model);
  if (models.length === 0) throw new Error('ChatGPT /models 没有当前账号可用的模型');

  const modelIds = new Set<string>();
  for (const model of models) {
    if (modelIds.has(model.id)) throw new Error(`ChatGPT /models 包含重复模型: ${model.id}`);
    modelIds.add(model.id);
  }
  return models;
}
