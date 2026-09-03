import { describe, expect, it, vi } from 'vitest';
import {
  createHistorySummaryEvent,
  DEFAULT_CONTEXT_COMPACTION_POLICY,
  RunIdSchema,
} from '../../../contracts';
import type {
  CanonicalInferenceMessage,
  ImageInputAdmissionEvidence,
  LlmInputMaterializationAttempt,
  LlmInputMaterializerPort,
  LlmRequestMessage,
  ResolvedLlmInputMessage,
  TokenizerPort,
} from '../../../ports';
import { createScriptedInferenceHarness } from '../../../testkit/agent-harness/scriptedInferenceHarness';
import { LlmCaller } from '../../llm/caller';
import type { ModelCatalogEntry, ModelCatalogLike } from '../../llm/modelCatalog';
import { ModelResolver } from '../../llm/modelResolver';
import { GraphAgentExecutor } from '../executor';
import type {
  GraphExecutorContextApplyOutput,
  GraphExecutorContextBuilder,
} from '../executorContextBuilder';

const MODEL_ID = 'vision-compaction-model';
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const IMAGE_REFERENCE = {
  id: 'render-attachment',
  kind: 'image' as const,
  resourceId: 'render-asset',
  mediaType: 'image/png' as const,
  byteLength: IMAGE_BYTES.byteLength,
  width: 8,
  height: 5,
  sha256: 'a'.repeat(64),
};
const IMAGE_ADMISSION_EVIDENCE: ImageInputAdmissionEvidence = {
  inputBudget: 100,
  nonImageEstimatedTokens: 79,
  initialProfileId: 'vision-profile',
  attachments: [{
    messageIndex: 2,
    attachmentIndex: 0,
    id: IMAGE_REFERENCE.id,
    resourceId: IMAGE_REFERENCE.resourceId,
    placement: 'tool_result_image',
    estimatedTokens: 1,
  }],
};
const PROMPT_BUDGET = {
  effectiveWindowTokens: 120,
  outputLimitTokens: 20,
  inputBudgetTokens: 100,
  toolDefinitionTokens: 0,
  messageBudgetTokens: 100,
};
const MEASUREMENT_POLICY = {
  remote_count_enabled: false,
  remote_count_failure_behavior: 'use-local-estimate' as const,
};

function createVisionModelCatalog(): ModelCatalogLike {
  const model: ModelCatalogEntry = {
    id: MODEL_ID,
    enabled: true,
    capabilities: ['chat', 'image_input'],
    adapter_input_support: { user_image: false, tool_result_image: true },
    inference_route: {
      context_window_tokens: PROMPT_BUDGET.effectiveWindowTokens,
      max_output_tokens: PROMPT_BUDGET.outputLimitTokens,
    },
  };
  return {
    getModelById: id => id === MODEL_ID ? model : undefined,
    getModelsByCapability: capability => model.capabilities?.includes(capability) ? [model] : [],
    getModelsByUIVisibility: () => [],
  };
}

function estimateMessage(message: LlmRequestMessage): number {
  const content = 'content' in message && typeof message.content === 'string'
    ? message.content
    : '';
  const match = /\[tokens:(\d+)\]/u.exec(content);
  return match ? Number(match[1]) : 0;
}

function createContextBuilder(): GraphExecutorContextBuilder {
  return {
    async build() {
      return {
        llmMessages: [
          { role: 'user', content: '检查幻灯片 [tokens:79]' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'render-call' }],
          },
          {
            role: 'tool',
            tool_call_id: 'render-call',
            content: '幻灯片渲染结果',
            attachments: [IMAGE_REFERENCE],
          },
        ],
        imageInputAdmissionEvidence: IMAGE_ADMISSION_EVIDENCE,
        promptBudget: PROMPT_BUDGET,
        promptUsageMeasurementPolicy: MEASUREMENT_POLICY,
        contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
        contextCompactionCandidate: {
          plan: {
            fingerprint: 'image-compaction-plan',
            sourceMessageIds: ['current-user', 'render-call', 'render-output'],
            replacedMessageIds: ['old-tool-call', 'old-tool-output'],
            originalMessageCount: 2,
            includedOldSummary: false,
            nextSummarySeq: 1,
            sourceTokenEstimate: 80,
            replacedTokenEstimate: 40,
            replacedToolGroupCount: 1,
            keptToolGroupCount: 2,
            replaceableRangeExhausted: true,
          },
          policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
          reminder: '生成上下文摘要 [tokens:0]',
        },
      };
    },
    async applyCompaction(input): Promise<GraphExecutorContextApplyOutput> {
      return {
        kind: 'ready',
        rebuiltContext: {
          llmMessages: [{ role: 'user', content: '压缩后继续 [tokens:40]' }],
          promptBudget: PROMPT_BUDGET,
          promptUsageMeasurementPolicy: MEASUREMENT_POLICY,
          contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
        },
        pendingSummaryEvent: createHistorySummaryEvent(
          input.summaryId,
          input.conversationId,
          input.turnId,
          input.checkpointContent,
          [...input.plan.replacedMessageIds],
          input.plan.originalMessageCount,
          input.plan.nextSummarySeq,
          {
            timestamp: input.timestamp,
            compression_ratio: 0.2,
            included_old_summary: false,
          },
        ),
        compressionRatio: 0.2,
        summaryTokenEstimate: 8,
      };
    },
  };
}

function createImageMaterializer(
  attempts: LlmInputMaterializationAttempt[],
): LlmInputMaterializerPort {
  return {
    async materialize(attempt): Promise<ResolvedLlmInputMessage[]> {
      attempts.push(attempt);
      const [userMessage, assistantMessage, toolMessage, reminderMessage] = attempt.messages;
      if (
        userMessage?.role !== 'user'
        || assistantMessage?.role !== 'assistant'
        || !('tool_calls' in assistantMessage)
        || toolMessage?.role !== 'tool'
        || !('tool_call_id' in toolMessage)
        || reminderMessage?.role !== 'user'
      ) {
        throw new Error('测试压缩 Prompt 结构不符合预期。');
      }
      return [
        { role: 'user', content: userMessage.content },
        assistantMessage,
        {
          role: 'tool',
          tool_call_id: toolMessage.tool_call_id,
          content: toolMessage.content,
          attachments: [{
            id: IMAGE_REFERENCE.id,
            resourceId: IMAGE_REFERENCE.resourceId,
            mediaType: IMAGE_REFERENCE.mediaType,
            byteLength: IMAGE_REFERENCE.byteLength,
            width: IMAGE_REFERENCE.width,
            height: IMAGE_REFERENCE.height,
            placement: 'tool_result_image',
            bytes: IMAGE_BYTES,
          }],
        },
        { role: 'user', content: reminderMessage.content },
      ];
    },
  };
}

function hasImageBlock(message: CanonicalInferenceMessage | undefined): boolean {
  return message?.role === 'tool'
    && message.content.some(block => block.type === 'image' && block.bytes === IMAGE_BYTES);
}

describe('GraphAgentExecutor image context compaction', () => {
  it('物化含图完整 Prompt，提交摘要后继续主调用', async () => {
    const modelCatalog = createVisionModelCatalog();
    const materializationAttempts: LlmInputMaterializationAttempt[] = [];
    const inference = createScriptedInferenceHarness([
      {
        contentChunks: ['checkpoint'],
        assertCall: call => {
          expect(hasImageBlock(call.messages[2])).toBe(true);
          expect(call.messages[call.messages.length - 1]).toEqual({
            role: 'user',
            content: [{
              type: 'text',
              text: '<system-reminder>\n生成上下文摘要 [tokens:0]\n</system-reminder>',
            }],
          });
        },
      },
      {
        contentChunks: ['done'],
        assertCall: call => {
          expect(call.messages).toEqual([{
            role: 'user',
            content: [{ type: 'text', text: '压缩后继续 [tokens:40]' }],
          }]);
        },
      },
    ], {
      modelCatalog,
      llmInputMaterializer: createImageMaterializer(materializationAttempts),
    });
    const llmCaller: LlmCaller = inference.getLlmCaller();
    const tokenizer: TokenizerPort = {
      estimateText: () => 0,
      estimateMessage,
    };
    const executor = new GraphAgentExecutor({
      llmCaller,
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
      },
      contextBuilder: createContextBuilder(),
      modelCatalog,
      modelResolver: new ModelResolver({ modelCatalog }),
      tokenizer,
    });
    const committedEvents: string[] = [];

    const result = await executor.tick({
      request: {
        query: '继续检查幻灯片',
        promptKey: 'default',
        model_id: MODEL_ID,
        enableTools: false,
      },
      history: [],
      toolContext: {
        conversationId: 'conversation-image-compaction',
        turnId: 'turn-image-compaction',
        runId: RunIdSchema.parse('run-image-compaction'),
      },
      executorLocal: { stepCount: 0 },
      runtimeEventCommitPort: async event => {
        committedEvents.push(event.type);
      },
    }, vi.fn());

    inference.assertAllTurnsConsumed();
    expect(result.decision).toEqual({ kind: 'final_answer', answer: 'done' });
    expect(materializationAttempts).toHaveLength(1);
    expect(materializationAttempts[0]?.admissionEvidence).toEqual(IMAGE_ADMISSION_EVIDENCE);
    expect(materializationAttempts[0]?.messages).toHaveLength(4);
    expect(committedEvents).toEqual(['history_summary']);
  });
});
