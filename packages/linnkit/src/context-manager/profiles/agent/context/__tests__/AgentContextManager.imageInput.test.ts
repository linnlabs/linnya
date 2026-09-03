import { describe, expect, it, vi } from 'vitest';
import {
  defineContextPolicy,
  type AiMessage,
  ToolCallIdSchema,
  type TokenRoute,
} from '../../../../../contracts';
import type {
  LlmImageInputEstimatorPort,
  TokenCounterPort,
  TokenizerPort,
} from '../../../../../ports';
import { AgentContextManager } from '../AgentContextManager';
import {
  AgentCoreContextProvider,
  AgentWorkingMemoryProvider,
  ContextProviderRegistry,
} from '../providers';

const imageRef = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

const route: TokenRoute = {
  capabilityId: 'test',
  modelId: 'vision-model',
  capabilities: { supportsRemoteTokenCount: true },
};

const tokenizer: TokenizerPort = {
  estimateText: () => 5,
  estimateMessage: () => 5,
};

const estimator: LlmImageInputEstimatorPort = {
  estimateImageInput: vi.fn(() => ({
    estimatedTokens: 100,
    profileId: 'vision-profile',
    estimatorVersion: 'test-v1',
  })),
};

function createManager(tokenCounter: TokenCounterPort): AgentContextManager {
  const registry = new ContextProviderRegistry();
  registry.register(new AgentCoreContextProvider());
  return new AgentContextManager({
    providerRegistry: registry,
    tokenizer,
    tokenizerModelId: route.modelId,
    tokenRoute: route,
    tokenCounter,
    remoteCount: { enabled: true, failureBehavior: 'use-local-estimate' },
    imageInputEstimator: estimator,
  });
}

describe('AgentContextManager image input budget', () => {
  it('同一 run 的 14 个含图工具组服从当前 run 通用规则，不受旧的 10 张图片门禁影响', async () => {
    const registry = new ContextProviderRegistry();
    registry.register(new AgentCoreContextProvider());
    registry.register(new AgentWorkingMemoryProvider());
    const manager = new AgentContextManager({
      providerRegistry: registry,
      tokenizer,
      tokenizerModelId: route.modelId,
      tokenRoute: route,
      tokenCounter: { countMessages: vi.fn() },
      imageInputEstimator: estimator,
    });
    const messages: AiMessage[] = [{
      id: 'current-user',
      role: 'user',
      type: 'user_input',
      content: '检查全部幻灯片',
      timestamp: 1,
    }];
    for (let index = 0; index < 14; index += 1) {
      const toolCallId = ToolCallIdSchema.parse(`call-slide-${index}`);
      messages.push({
        id: `tool-call-${index}`,
        role: 'assistant',
        type: 'tool_calls',
        content: '',
        timestamp: index + 2,
        metadata: {
          tool_calls: [{
            id: toolCallId,
            type: 'function',
            function: { name: 'read_file', arguments: `{"path":"slide-${index}.png"}` },
          }],
        },
      }, {
        id: `tool-output-${index}`,
        role: 'tool',
        type: 'tool_output',
        content: `已读取 slide-${index}.png`,
        timestamp: index + 2,
        metadata: {
          tool_call_id: toolCallId,
          tool_name: 'read_file',
          data: { path: `slide-${index}.png` },
        },
        attachments: [{
          ...imageRef,
          id: `attachment-${index}`,
          resourceId: `asset-${index}`,
        }],
      });
    }

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '检查全部幻灯片' },
      messages,
      20_000,
    );

    expect(result.messages).toHaveLength(messages.length);
    expect(result.imageInputAdmissionEvidence?.attachments).toHaveLength(14);
    expect(result.messages.filter(message => message.type === 'tool_output')).toHaveLength(14);
  });

  it('图片-only 消息按整条消息参与预算，并从同一估算拆出 component 与 admission evidence', async () => {
    const countMessages = vi.fn<TokenCounterPort['countMessages']>();
    const manager = createManager({ countMessages });
    const policy = defineContextPolicy({ contextTrace: { enabled: true } });
    const messages: AiMessage[] = [
      {
        id: 'system-1',
        role: 'system',
        type: 'system_prompt',
        content: 'system',
        timestamp: 1,
      },
      {
        id: 'user-image',
        role: 'user',
        type: 'user_input',
        content: '',
        timestamp: 2,
        attachments: [imageRef],
      },
    ];

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '' },
      messages,
      200,
      {
        policy: policy.contextTrace,
        effectiveContextPolicy: policy,
      },
    );

    expect(result.messages.map(message => message.id)).toEqual(['system-1', 'user-image']);
    expect(result.tokenUsage.used).toBe(110);
    expect(result.tokenComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentId: '1:user-image',
        kind: 'user',
        tokens: 5,
        kept: true,
      }),
      expect.objectContaining({
        componentId: '1:user-image:image:0',
        kind: 'image-attachment',
        tokens: 100,
        messageId: 'user-image',
        attachmentId: imageRef.id,
        resourceId: imageRef.resourceId,
        placement: 'user_image',
        profileId: 'vision-profile',
        estimatorVersion: 'test-v1',
        kept: true,
      }),
    ]));
    expect(result.tokenComponents?.reduce((total, component) => total + component.tokens, 0)).toBe(110);
    expect(result.imageInputAdmissionEvidence).toEqual({
      inputBudget: 200,
      nonImageEstimatedTokens: 10,
      initialProfileId: 'vision-profile',
      attachments: [{
        messageIndex: 1,
        attachmentIndex: 0,
        id: imageRef.id,
        resourceId: imageRef.resourceId,
        placement: 'user_image',
        estimatedTokens: 100,
      }],
    });
    expect(result.contextTrace?.tokenComponents).toEqual(result.tokenComponents);
  });

  it('含图时不调用 pre-materialization remote counter，并记录稳定 local-only 原因', async () => {
    const countMessages = vi.fn<TokenCounterPort['countMessages']>();
    const manager = createManager({ countMessages });
    const policy = defineContextPolicy({ contextTrace: { enabled: true } });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '' },
      [{
        id: 'user-image',
        role: 'user',
        type: 'user_input',
        content: '',
        timestamp: 1,
        attachments: [imageRef],
      }],
      200,
      {
        policy: policy.contextTrace,
        effectiveContextPolicy: policy,
      },
    );

    expect(countMessages).not.toHaveBeenCalled();
    expect(result.contextTrace?.remoteTokenCount).toMatchObject({
      enabled: true,
      attempted: false,
      applied: false,
      localEstimateTokens: 105,
      skipReason: 'image_input_local_only',
    });
  });

  it('图片不触发 Context Manager 专属超预算错误，最终 route 继续消费 admission evidence 做统一 preflight', async () => {
    const manager = createManager({ countMessages: vi.fn() });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '' },
      [{
        id: 'user-image',
        role: 'user',
        type: 'user_input',
        content: '',
        timestamp: 1,
        attachments: [imageRef],
      }],
      100,
    );

    expect(result.messages.map(message => message.id)).toEqual(['user-image']);
    expect(result.tokenUsage.used).toBe(105);
    expect(result.imageInputAdmissionEvidence).toMatchObject({
      inputBudget: 100,
      initialProfileId: 'vision-profile',
      attachments: [{ id: imageRef.id, resourceId: imageRef.resourceId }],
    });
  });
});
