import { describe, expect, it, vi } from 'vitest';
import { ToolCallIdSchema } from '../../../../contracts';
import { createPromptUsageMeasurer } from '../../orchestration/measurePromptUsage';
import { createTestTickPipelineContext } from '../__tests__/createTestTickPipelineContext';
import { runTickPipeline } from '../runTickPipeline';
import { createApplySystemReminderStage } from './applySystemReminderStage';
import { createMeasurePromptUsageStage } from './measurePromptUsageStage';

describe('measure_prompt_usage pipeline', () => {
  it('在 system reminder 之后，把最终 messages 与 prepared tools 一起交给 remote counter', async () => {
    const countMessages = vi.fn(async () => ({
      inputTokens: 120,
      source: 'provider-preflight-count' as const,
      confidence: 'provider-estimate' as const,
    }));
    const ctx = createTestTickPipelineContext({
      context: {
        modelId: 'main-model',
        llmMessages: [{ role: 'user', content: '继续' }],
        llmOptions: {
          tools: [{
            name: 'search',
            description: 'search',
            parameters: { type: 'object', properties: {} },
          }],
          tool_choice: 'auto',
        },
        promptBudget: {
          effectiveWindowTokens: 1_200,
          outputLimitTokens: 200,
          inputBudgetTokens: 1_000,
          toolDefinitionTokens: 10,
          messageBudgetTokens: 990,
        },
        promptUsageMeasurementPolicy: {
          token_route: {
            capabilityId: 'test',
            modelId: 'main-model',
            capabilities: { supportsRemoteTokenCount: true },
          },
          remote_count_enabled: true,
          remote_count_failure_behavior: 'use-local-estimate',
        },
        history: [
          {
            id: 'user-1',
            type: 'user_input',
            conversation_id: 'conv_test',
            turn_id: 'turn_test',
            timestamp: 1,
            version: 1,
            source: 'user',
            content: 'question',
          },
          {
            id: 'tool-1',
            type: 'tool_call_decision',
            conversation_id: 'conv_test',
            turn_id: 'turn_test',
            timestamp: 2,
            version: 1,
            tool_name: 'search',
            tool_call_id: ToolCallIdSchema.parse('tool-1'),
            phase: 'complete',
            status: 'success',
          },
          {
            id: 'tool-2',
            type: 'tool_call_decision',
            conversation_id: 'conv_test',
            turn_id: 'turn_test',
            timestamp: 3,
            version: 1,
            tool_name: 'search',
            tool_call_id: ToolCallIdSchema.parse('tool-2'),
            phase: 'complete',
            status: 'success',
          },
        ],
        executorLocal: {
          stepCount: 2,
          maxSteps: 20,
          remainingSteps: 18,
          systemReminderPolicy: {
            enabledRuleIds: ['tool_call_streak_every_ten'],
            thresholds: { toolCallStreak: 2 },
          },
        },
      },
    });
    const measurer = createPromptUsageMeasurer({
      tokenizer: {
        estimateText: () => 10,
        estimateMessage: () => 20,
      },
      tokenCounter: { countMessages },
      now: () => 123,
    });

    await runTickPipeline(ctx, [
      createApplySystemReminderStage(),
      createMeasurePromptUsageStage({ promptUsageMeasurer: measurer }),
    ]);

    expect(JSON.stringify(ctx.llmMessages)).toContain('你已连续执行了 2 次工具调用');
    expect(countMessages).toHaveBeenCalledWith(expect.objectContaining({
      messages: ctx.llmMessages,
      tools: ctx.llmOptions.tools,
    }));
    expect(ctx.promptUsageCandidate?.used_tokens).toBe(120);
  });
});
