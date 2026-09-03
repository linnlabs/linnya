import { PromptKeys } from '@app/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { audit, execution, graph, llm, telemetry, tools } from '@linnlabs/linnkit/runtime-kernel';
import type { RoutedRuntimeEvent, RuntimeResourceRef, UserInputEvent } from '@linnlabs/linnkit/contracts';
import { createScriptedInferenceHarness, createToolContextFixture } from '@linnlabs/linnkit/testkit';
import type {
  CanonicalInferencePort,
  LlmInputMaterializerPort,
  LlmRequestMessage,
  ResolvedLlmInputMessage,
} from '@linnlabs/linnkit/ports';
import {
  createLinnyaChildRunInvoker,
  toChildRunAgentConfig,
} from 'src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory';
import { createImageInputProcessingProfileRegistry } from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import {
  CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE,
  OPENAI_RESPONSES_IMAGE_INPUT_PROFILE,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { clearRegisteredAgentTaskCache } from 'src/app-hosts/linnya/agent-registry/agentTaskResolver';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { createInMemoryToolResultAssetClaimRegistry } from 'src/domains/assets/features/tool-result-claims';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { createToolImageModelCatalog } from 'src/app-hosts/linnya/testkit/agent-harness/toolImageIntegrationFixtures';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';

const truncateObservation: tools.ObservationPreviewPort['truncateObservation'] = async params => ({
  truncated: false,
  preview: params.text,
});

const noopObservationPreview: tools.ObservationPreviewPort = {
  truncateObservation: vi.fn(truncateObservation),
};

function createChildRuntimeEventSink(): graph.RuntimeEventSink {
  const sequencer = new execution.EventSequencer('child-invoker-factory-test');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('child-invoker-factory-test-run'),
    lane: 'child',
    visibility: 'parent-trace',
  });
  return (event, source) => publisher.publish(event, source);
}

function createCollectingChildRuntimeEventSink(): {
  readonly sink: graph.RuntimeEventSink;
  readonly events: RoutedRuntimeEvent[];
} {
  const events: RoutedRuntimeEvent[] = [];
  const sequencer = new execution.EventSequencer('child-image-read-test');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('child-image-read-run'),
    parent_run_id: RunIdSchema.parse('parent-image-read-run'),
    lane: 'child',
    visibility: 'parent-trace',
  });
  return {
    events,
    sink(event, source) {
      const routed = publisher.publish(event, source);
      events.push(routed);
      return routed;
    },
  };
}

const imageRef: RuntimeResourceRef = {
  id: 'attachment-child-1',
  kind: 'image',
  resourceId: 'asset-child-1',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

function resolveImageMessages(messages: readonly LlmRequestMessage[]): ResolvedLlmInputMessage[] {
  return messages.map(message => {
    if (!('attachments' in message)) return message;
    const { attachments, ...messageWithoutDurableAttachments } = message;
    if (!attachments?.length) return messageWithoutDurableAttachments;
    return {
      ...messageWithoutDurableAttachments,
      attachments: attachments.map(attachment => ({
        id: attachment.id,
        resourceId: attachment.resourceId,
        mediaType: attachment.mediaType,
        byteLength: attachment.byteLength,
        width: attachment.width,
        height: attachment.height,
        placement:
          message.role === 'tool' ? ('tool_result_image' as const) : ('user_image' as const),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    };
  });
}

describe('childRunInvokerFactory', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    clearRegisteredAgentTaskCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRegisteredAgentTaskCache();
    clearPluginRuntimeStateForTests();
    resetAgentRuntimeSingletonsForTest();
  });

  it('应把 AgentDefinition 映射为 ChildRunAgentConfig，而不把 registry 类型泄漏到 core', () => {
    const agentDefinition: AgentDefinition = {
      id: 'deep-search',
      promptKey: PromptKeys.DEFAULT,
      defaultMode: 'agent',
      description: 'test agent',
      config: {
        availableTools: ['tool_a', 'tool_b'],
        modelPolicy: { kind: 'fixed', modelId: 'gpt-test' },
        stepPolicy: {
          kind: 'force_tools',
          lastStepsHintThreshold: 2,
          forcedTools: ['tool_b'],
        },
        contextPolicy: {
          profileId: 'agent',
          systemReminder: { enabledRuleIds: ['reminder_a'] },
        },
      },
      task: {
        systemPromptBuilder: () => 'system prompt',
      },
    };

    expect(toChildRunAgentConfig(agentDefinition)).toEqual({
      id: 'deep-search',
      promptKey: PromptKeys.DEFAULT,
      availableTools: ['tool_a', 'tool_b'],
      contextPolicy: {
        profileId: 'agent',
        systemReminder: { enabledRuleIds: ['reminder_a'] },
      },
      modelPolicy: { kind: 'fixed', modelId: 'gpt-test' },
      stepPolicy: {
        kind: 'force_tools',
        lastStepsHintThreshold: 2,
        forcedTools: ['tool_b'],
      },
      systemReminderPolicy: { enabledRuleIds: ['reminder_a'] },
      systemPromptBuilder: agentDefinition.task?.systemPromptBuilder,
    });
  });

  it('应允许宿主显式覆写 child-run invoker 默认依赖，而不是继续把装配藏在 compatibility facade 中', async () => {
    const modelResolver = new llm.ModelResolver({
      fallbackModelPreferredOrder: [],
    });
    const resolveModelIdSpy = vi
      .spyOn(modelResolver, 'resolveModelId')
      .mockReturnValue('explicit-model');
    const runLlmNode: graph.GraphNode['run'] = async () => ({ kind: 'yield', events: [] });
    const llmNode: graph.GraphNode = {
      id: 'llm',
      run: vi.fn(runLlmNode),
    };

    const invoker = createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: audit.noopAudit,
      modelResolver,
      createLlmNode: () => llmNode,
      observationPreview: noopObservationPreview,
      eventToMessageConverter: vi.fn(() => []),
      defaultJudgeToolName: 'judge_tool',
    });

    await invoker.invoke({
      agentConfig: {
        id: 'child-agent',
        promptKey: PromptKeys.DEFAULT,
      },
      userMessage: '继续执行',
      conversationId: 'conv-child-invoker-factory',
      parentToolContext: {},
      runtimeEventSink: createChildRuntimeEventSink(),
    });

    expect(resolveModelIdSpy).toHaveBeenCalledTimes(1);
    expect(llmNode.run).toHaveBeenCalledTimes(1);
  });

  it('显式传入图片历史时，child 默认 LlmNode 使用同一 estimator、materializer 与 route gate', async () => {
    const activeModelId = 'child-image-model';
    const modelEntry: llm.ModelCatalogEntry = {
      id: activeModelId,
      enabled: true,
      api_key: 'test-key',
      capabilities: ['chat', 'image_input'],
      adapter_input_support: { user_image: true, tool_result_image: false },
      inference_route: {
        context_window_tokens: 128_000,
        max_output_tokens: 8_192,
      },
    };
    const modelCatalog: llm.ModelCatalogLike = {
      getModelById: id => (id === activeModelId ? modelEntry : undefined),
      getModelsByCapability: capability =>
        modelEntry.capabilities?.includes(capability) ? [modelEntry] : [],
      getModelsByUIVisibility: () => [],
    };
    const modelResolver = new llm.ModelResolver({ modelCatalog });
    const profileRegistry = createImageInputProcessingProfileRegistry({
      resolveRouteForModel: modelId => (modelId === activeModelId ? 'openai' : undefined),
      bindings: [{ route: 'openai', profile: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE }],
    });
    const materializer: LlmInputMaterializerPort = {
      materialize: vi.fn(async attempt => resolveImageMessages(attempt.messages)),
    };
    const requests: Parameters<CanonicalInferencePort['stream']>[0][] = [];
    const inferencePort: CanonicalInferencePort = {
      async *stream(request) {
        requests.push(request);
        yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
        yield { type: 'answer_delta', text: 'child image processed' };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const llmCaller = new llm.LlmCaller({
      inferencePort,
      modelCatalog,
      modelResolver,
      llmInputMaterializer: materializer,
      maxRetries: 0,
    });
    const toolRuntime = {
      getToolDefinition: () => undefined,
      executeTool: async () => ({ success: false, error: 'not configured', durationMs: 0 }),
      getToolSchemas: () => [],
    };
    const invoker = createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: audit.noopAudit,
      modelResolver,
      modelCatalog,
      llmCaller,
      llmImageInputEstimator: profileRegistry,
      toolRuntime,
      observationPreview: noopObservationPreview,
    });
    const seedImageEvent: UserInputEvent = {
      type: 'user_input',
      id: 'child-seed-image-event',
      timestamp: 1,
      turn_id: 'parent-turn',
      conversation_id: 'parent-conversation',
      version: 1,
      source: 'user',
      content: '父任务显式传入的图片',
      attachments: [imageRef],
    };

    const result = await invoker.invoke({
      agentConfig: {
        id: 'child-image-agent',
        promptKey: PromptKeys.DEFAULT,
        modelPolicy: { kind: 'fixed', modelId: activeModelId },
      },
      userMessage: '分析显式传入的图片',
      conversationId: 'parent-conversation',
      parentToolContext: {},
      runtimeEventSink: createChildRuntimeEventSink(),
      seedHistoryEvents: [seedImageEvent],
    });

    expect(result.success).toBe(true);
    expect(materializer.materialize).toHaveBeenCalledTimes(1);
    expect(materializer.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        activeModelId,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            attachments: [imageRef],
          }),
        ]),
        admissionEvidence: expect.objectContaining({
          initialProfileId: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE.id,
          attachments: [
            expect.objectContaining({
              id: imageRef.id,
              resourceId: imageRef.resourceId,
              placement: 'user_image',
            }),
          ],
        }),
      })
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'image',
              media_type: 'image/png',
              bytes: new Uint8Array([1, 2, 3]),
            }),
          ]),
        }),
      ])
    );
  });

  it('child 调用 read_file 后把 durable 图片作为 tool_result_image 交给下一轮模型', async () => {
    const activeModelId = 'child-read-file-image-model';
    const conversationId = 'child-read-file-image-conversation';
    const sourcePath = '/conversation/slides-renders/run-1/slide-001.png';
    const modelCatalog = createToolImageModelCatalog(activeModelId);
    const modelResolver = new llm.ModelResolver({ modelCatalog });
    const profileRegistry = createImageInputProcessingProfileRegistry({
      resolveRouteForModel: modelId => modelId === activeModelId ? 'openai_responses' : undefined,
      bindings: [{ route: 'openai_responses', profile: OPENAI_RESPONSES_IMAGE_INPUT_PROFILE }],
    });
    const materializationAttempts: Parameters<LlmInputMaterializerPort['materialize']>[0][] = [];
    const materializer: LlmInputMaterializerPort = {
      materialize: vi.fn(async attempt => {
        materializationAttempts.push(attempt);
        return resolveImageMessages(attempt.messages);
      }),
    };
    const aiHarness = createScriptedInferenceHarness(
      [
        {
          toolCalls: [{
            id: 'child-read-file-call',
            name: 'read_file',
            argumentsJson: JSON.stringify({
              locator: 'conversation:/slides-renders/run-1/slide-001.png',
            }),
          }],
        },
        { contentChunks: ['子任务已看完图片。'] },
      ],
      { modelCatalog, llmInputMaterializer: materializer },
    );
    const toolHarness = createToolRuntimeHarness([new ReadFileTool()]);
    const claims = createInMemoryToolResultAssetClaimRegistry({
      createClaimId: () => 'child-read-file-claim',
    });
    const conversationAdmission: ConversationWorkDirectoryAdmissionPort = {
      withAdmission: async (input, admitted) => {
        expect(input.conversationId).toBe(conversationId);
        return admitted({
          identity: deriveConversationWorkDirectoryIdentity(conversationId),
          absolutePath: '/conversation',
          status: 'existing',
        });
      },
    };
    let resolvedImageRef: RuntimeResourceRef | undefined;
    const modelInputResolver: tools.ToolModelInputResolverPort = {
      resolveToolModelInput: vi.fn(async input => {
        expect(input.toolName).toBe('read_file');
        expect(input.toolCallId).toBe('child-read-file-call');
        expect(input.selections).toEqual([
          expect.objectContaining({ uri: 'artifact://tool-results/child-read-file-claim' }),
        ]);
        const selection = input.selections[0];
        if (!selection) {
          throw new Error('read_file 应声明一张工具结果图片。');
        }
        resolvedImageRef = { ...imageRef, id: selection.id };
        return [resolvedImageRef];
      }),
      completeToolModelInput: vi.fn(async () => undefined),
    };
    const parentToolContext = createToolContextFixture({
      conversationId,
      patch: {
        physicalFileReader: {
          readFile: vi.fn(async input => {
            expect(input).toEqual({
              absolutePath: sourcePath,
              scope: { kind: 'conversation', rootPath: '/conversation' },
            });
            return {
              kind: 'image_source' as const,
              resolvedPath: sourcePath,
              fileName: 'slide-001.png',
              detectedMediaType: 'image/png' as const,
              byteLength: imageRef.byteLength,
            };
          }),
        },
        conversationWorkDirectoryAdmission: conversationAdmission,
        managedImageIngress: {
          ingestLocalImage: vi.fn(async input => {
            expect(input.sourcePath).toBe(sourcePath);
            return {
              assetId: imageRef.resourceId,
              uri: `asset://assets/${imageRef.resourceId}`,
              mediaType: imageRef.mediaType,
              byteLength: imageRef.byteLength,
              width: imageRef.width ?? 0,
              height: imageRef.height ?? 0,
              sha256: imageRef.sha256 ?? '',
              localPath: '/managed/asset-child-1.png',
              createdAt: 1,
            };
          }),
        },
        toolResultAssetClaims: claims,
      },
    });
    parentToolContext.runId = RunIdSchema.parse('parent-image-read-run');
    const runtime = createCollectingChildRuntimeEventSink();
    const invoker = createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: audit.noopAudit,
      modelResolver,
      modelCatalog,
      llmCaller: aiHarness.getLlmCaller(),
      llmImageInputEstimator: profileRegistry,
      toolRuntime: toolHarness.toolRuntime,
      modelInputResolver,
      observationPreview: noopObservationPreview,
    });

    try {
      const result = await invoker.invoke({
        agentConfig: {
          id: 'child-read-file-image-agent',
          promptKey: PromptKeys.DEFAULT,
          availableTools: ['read_file'],
          modelPolicy: { kind: 'fixed', modelId: activeModelId },
        },
        userMessage: '读取并分析第一张幻灯片。',
        conversationId,
        runId: RunIdSchema.parse('child-image-read-run'),
        parentRunId: RunIdSchema.parse('parent-image-read-run'),
        parentToolContext,
        runtimeEventSink: runtime.sink,
      });

      aiHarness.assertAllTurnsConsumed();
      expect(result).toMatchObject({
        success: true,
        finalAnswer: '子任务已看完图片。',
      });
      expect(toolHarness.getExecutions()).toHaveLength(1);
      expect(runtime.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_output',
          status: 'success',
          tool_call_id: 'child-read-file-call',
          attachments: [resolvedImageRef],
        }),
      ]));
      expect(materializationAttempts[materializationAttempts.length - 1]?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          attachments: [resolvedImageRef],
        }),
      ]));
      const llmCalls = aiHarness.getCalls();
      expect(llmCalls[llmCalls.length - 1]?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'image',
              media_type: 'image/png',
              bytes: new Uint8Array([1, 2, 3]),
            }),
          ]),
        }),
      ]));
    } finally {
      toolHarness.restore();
    }
  });
});
