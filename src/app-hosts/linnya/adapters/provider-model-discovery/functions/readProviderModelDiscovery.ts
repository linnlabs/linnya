import { z } from 'zod';
import type { ProviderModelDefinition } from '@linnya/provider-catalog';

import {
  ProviderModelDiscoveryError,
  type ProviderDiscoveredModel,
} from '../definitions/providerModelDiscovery';

const NonEmptyString = z.string().trim().min(1);
const PositiveInteger = z.number().int().positive().safe();
const DeepSeekIdentity = z.object({ id: NonEmptyString, name: z.unknown().optional() });
const DeepSeekMetadata = z.object({
  name: NonEmptyString,
  context_window: PositiveInteger,
  max_output_tokens: PositiveInteger,
  input_modalities: z.array(NonEmptyString).min(1),
  output_modalities: z.array(NonEmptyString).min(1),
  effort: z.object({ supported_levels: z.array(NonEmptyString) }).optional(),
});
const OllamaTag = z.object({ name: NonEmptyString });
const OllamaDetails = z.object({
  capabilities: z.array(NonEmptyString),
  model_info: z.record(z.unknown()),
});

function unavailable(id: string, displayName: string, reason: string): ProviderDiscoveredModel {
  return { status: 'unavailable', id, display_name: displayName, reason };
}

function assertUniqueIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new ProviderModelDiscoveryError('供应商模型列表包含重复模型 ID', 502);
  }
}

/** 官方列表决定成员资格；缺资料的真实新 ID 仍需在模型管理中可见。 */
export function readDeepSeekModels(value: unknown): readonly ProviderDiscoveredModel[] {
  const list = z.object({ data: z.array(z.unknown()) }).safeParse(value);
  if (!list.success) throw new ProviderModelDiscoveryError('DeepSeek 模型列表格式无效', 502);
  const models = list.data.data.map((entry): ProviderDiscoveredModel => {
    const identity = DeepSeekIdentity.safeParse(entry);
    if (!identity.success) {
      throw new ProviderModelDiscoveryError('DeepSeek 模型列表缺少有效模型 ID', 502);
    }
    const { id, name } = identity.data;
    const metadata = DeepSeekMetadata.safeParse(entry);
    if (!metadata.success) {
      const displayName = NonEmptyString.safeParse(name);
      return unavailable(
        id,
        displayName.success ? displayName.data : id,
        '供应商尚未提供完整模型资料'
      );
    }
    const model = metadata.data;
    if (!model.input_modalities.includes('text') || !model.output_modalities.includes('text')) {
      return unavailable(id, model.name, '该模型不支持文本对话');
    }
    if (model.max_output_tokens > model.context_window) {
      return unavailable(id, model.name, '供应商报告的模型容量不一致');
    }
    return {
      status: 'available',
      definition: {
        id,
        display_name: model.name,
        release_status: 'active',
        context_window_tokens: model.context_window,
        max_input_tokens: model.context_window,
        max_output_tokens: model.max_output_tokens,
        capabilities: {
          image_input: model.input_modalities.includes('image'),
          // DeepSeek connection 只接入已验收的 Chat Completions 工具协议。
          tool_call: true,
          reasoning: (model.effort?.supported_levels.length ?? 0) > 0,
        },
      },
    };
  });
  assertUniqueIds(
    models.map(model => (model.status === 'available' ? model.definition.id : model.id))
  );
  return models;
}

export function readOllamaModelIds(value: unknown): readonly string[] {
  const parsed = z.object({ models: z.array(OllamaTag) }).safeParse(value);
  if (!parsed.success) throw new ProviderModelDiscoveryError('Ollama 模型列表格式无效', 502);
  const ids = parsed.data.models.map(model => model.name);
  assertUniqueIds(ids);
  return ids;
}

export interface OllamaDiscoveredMetadata {
  readonly id: string;
  readonly contextWindow: number;
  readonly imageInput: boolean;
  readonly reasoning: boolean;
}

export function readOllamaModelMetadata(
  id: string,
  value: unknown
): OllamaDiscoveredMetadata | Extract<ProviderDiscoveredModel, { status: 'unavailable' }> {
  const parsed = OllamaDetails.safeParse(value);
  if (!parsed.success)
    return { status: 'unavailable', id, display_name: id, reason: '供应商尚未提供完整模型资料' };
  const { capabilities, model_info: info } = parsed.data;
  if (!capabilities.includes('completion')) {
    return { status: 'unavailable', id, display_name: id, reason: '该模型不支持文本对话' };
  }
  if (!capabilities.includes('tools')) {
    return {
      status: 'unavailable',
      id,
      display_name: id,
      reason: '该模型不支持 Agent 所需的工具调用',
    };
  }
  const architecture = NonEmptyString.safeParse(info['general.architecture']);
  const context = PositiveInteger.safeParse(
    architecture.success ? info[`${architecture.data}.context_length`] : undefined
  );
  if (!context.success) {
    return { status: 'unavailable', id, display_name: id, reason: '供应商尚未提供上下文容量' };
  }
  return {
    id,
    contextWindow: context.data,
    imageInput: capabilities.includes('vision'),
    reasoning: capabilities.includes('thinking'),
  };
}

/** models.dev/bundled 只补独立输出上限，不覆盖官方 membership、模态或上下文。 */
export function completeOllamaModelMetadata(
  model: OllamaDiscoveredMetadata,
  metadata: ProviderModelDefinition | undefined
): ProviderDiscoveredModel {
  if (!metadata) return unavailable(model.id, model.id, '尚无经过准入的最大输出容量资料');
  if (metadata.max_output_tokens > model.contextWindow) {
    return unavailable(model.id, metadata.display_name, '模型输出容量与供应商上下文容量不一致');
  }
  return {
    status: 'available',
    definition: {
      ...metadata,
      id: model.id,
      context_window_tokens: model.contextWindow,
      max_input_tokens: model.contextWindow,
      capabilities: {
        image_input: model.imageInput,
        tool_call: true,
        reasoning: model.reasoning,
      },
    },
  };
}
