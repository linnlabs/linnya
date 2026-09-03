import { describe, expect, it, vi } from 'vitest';
import { createPromptUsageMeasurer } from './measurePromptUsage';

const promptBudget = {
  effectiveWindowTokens: 1_200,
  outputLimitTokens: 200,
  inputBudgetTokens: 1_000,
  toolDefinitionTokens: 100,
  messageBudgetTokens: 900,
};

describe('createPromptUsageMeasurer', () => {
  it('remote count 接收最终 messages 与 tools，并归一化三项', async () => {
    const countMessages = vi.fn(async () => ({
      inputTokens: 100,
      source: 'provider-preflight-count' as const,
      confidence: 'provider-estimate' as const,
    }));
    const measure = createPromptUsageMeasurer({
      tokenizer: {
        estimateText: () => 10,
        estimateMessage: message => message.role === 'system' ? 20 : 70,
      },
      tokenCounter: { countMessages },
      now: () => 123,
    });

    const snapshot = await measure({
      budgetModelId: 'model-a',
      servedModelId: 'model-a',
      messages: [
        { role: 'system', content: '<available_skills>...</available_skills>' },
        { role: 'tool', tool_call_id: 'call-1', content: 'SKILL.md content' },
      ],
      llmOptions: {
        tools: [{
          name: 'skill',
          description: 'read skill',
          parameters: { type: 'object', properties: {} },
        }],
        tool_choice: 'auto',
      },
      promptBudget,
      measurementPolicy: {
        token_route: {
          capabilityId: 'test',
          modelId: 'model-a',
          capabilities: { supportsRemoteTokenCount: true },
        },
        remote_count_enabled: true,
        remote_count_failure_behavior: 'use-local-estimate',
      },
    });

    expect(countMessages).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.any(Array),
      tools: expect.any(Array),
    }));
    expect(snapshot).toMatchObject({
      used_tokens: 100,
      components: {
        system_prompt_tokens: 20,
        conversation_tokens: 70,
        tool_definition_tokens: 10,
      },
      source: 'provider-preflight-count',
      confidence: 'provider-estimate',
      measured_at: 123,
    });
  });

  it('remote count 失败时按策略回退到校准后的本地总数', async () => {
    const measure = createPromptUsageMeasurer({
      tokenizer: {
        estimateText: () => 10,
        estimateMessage: () => 20,
      },
      tokenCounter: { countMessages: vi.fn(async () => { throw new Error('offline'); }) },
    });

    const snapshot = await measure({
      budgetModelId: 'model-a',
      servedModelId: 'model-a',
      messages: [{ role: 'user', content: 'hello' }],
      llmOptions: {
        tools: [{
          name: 'tool',
          description: 'test tool',
          parameters: { type: 'object', properties: {} },
        }],
      },
      promptBudget,
      measurementPolicy: {
        token_route: {
          capabilityId: 'test',
          modelId: 'model-a',
          capabilities: { supportsRemoteTokenCount: true },
        },
        remote_count_enabled: true,
        remote_count_failure_behavior: 'use-local-estimate',
        calibration_coefficient: 2,
      },
    });

    expect(snapshot.used_tokens).toBe(60);
    expect(snapshot.source).toBe('local-estimate');
    expect(snapshot.components.tool_definition_tokens).toBe(20);
  });
});
