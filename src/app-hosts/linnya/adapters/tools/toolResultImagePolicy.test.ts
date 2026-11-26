import { llm } from '@linnlabs/linnkit/runtime-kernel';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { describe, expect, it } from 'vitest';
import type { ToolContext } from 'src/tools/types';
import { createToolResultImagePolicy } from './toolResultImagePolicy';

const catalog: llm.ModelCatalogLike = {
  getModelById(id) {
    if (id === 'vision-model') {
      return { id, enabled: true, capabilities: ['chat', 'image_input'],
        adapter_input_support: { user_image: true, tool_result_image: true } } as llm.ModelCatalogEntry;
    }
    if (id === 'text-model') {
      return { id, enabled: true, capabilities: ['chat'],
        adapter_input_support: { user_image: false, tool_result_image: false } } as llm.ModelCatalogEntry;
    }
    return undefined;
  },
  getModelsByCapability: () => [],
  getModelsByUIVisibility: () => [],
};

const callId = ToolCallIdSchema.parse('call-1');
const policy = createToolResultImagePolicy(catalog);

describe('createToolResultImagePolicy', () => {
  it('交给模型的结果按本次上下文的模型目录能力判断', () => {
    expect(policy.deliveryFor({ modelId: 'vision-model', parentToolCallId: callId } as ToolContext)).toBe('attach');
    expect(policy.deliveryFor({ modelId: 'text-model', parentToolCallId: callId } as ToolContext)).toBe('metadata_only');
    expect(policy.deliveryFor({ parentToolCallId: callId } as ToolContext)).toBe('metadata_only');
  });

  it('批次后直接交还 Host 调用方的那次调用默认附带图片，与 run 模型无关', () => {
    const hostCall = { toolName: 'read_file', toolCallId: callId, resultReceiver: 'host_caller' as const };
    expect(policy.deliveryFor({ modelId: 'text-model', parentToolCallId: callId,
      authorizedHostToolCall: hostCall } as ToolContext)).toBe('attach');
    // 同一 run 里其他调用（或结果仍交给模型的 Host 调用）不借用这项判断。
    expect(policy.deliveryFor({ modelId: 'text-model', parentToolCallId: ToolCallIdSchema.parse('call-2'),
      authorizedHostToolCall: hostCall } as ToolContext)).toBe('metadata_only');
    expect(policy.deliveryFor({ modelId: 'text-model', parentToolCallId: callId,
      authorizedHostToolCall: { toolName: 'read_file', toolCallId: callId } } as ToolContext)).toBe('metadata_only');
  });
});
