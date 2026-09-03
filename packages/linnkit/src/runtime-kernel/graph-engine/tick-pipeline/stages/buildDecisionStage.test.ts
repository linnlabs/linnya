import { describe, expect, it } from 'vitest';

import { createBuildDecisionStage } from './buildDecisionStage';
import { createTestTickPipelineContext } from '../__tests__/createTestTickPipelineContext';
import type { TickEvent } from '../types';
import { runTickPipeline } from '../runTickPipeline';

function providerContinuation(reasoning: string) {
  return [{
    schema_version: 2 as const,
    producer: {
      model_id: 'deepseek-reasoner',
      endpoint_id: 'deepseek',
      api_surface: 'openai_chat_completions',
      capability_id: 'test:chat-codec',
      endpoint_model_id: 'deepseek-reasoner',
    },
    kind: 'reasoning_content',
    payload: { provider: 'deepseek', type: 'reasoning_content', reasoning_content: reasoning },
  }];
}

describe('buildDecisionStage provider continuation', () => {
  it('工具调用决策事件应把 provider_continuations 绑定到 payload 标准位置', async () => {
    const providerContinuations = providerContinuation('Need the tool.');
    const assistantReplayParts = [{
      type: 'tool_call' as const,
      tool_call_id: 'call_1',
      provider_continuations: providerContinuations,
    }];
    const emittedEvents: TickEvent[] = [];
    const ctx = createTestTickPipelineContext({
      context: {
        llmResp: {
          content: '我先读取文档。',
          provider_continuations: providerContinuations,
          assistant_replay_parts: assistantReplayParts,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
            },
          ],
        },
        eventHandler: (event) => emittedEvents.push(event),
      },
    });

    await runTickPipeline(ctx, [createBuildDecisionStage()]);

    const decision = emittedEvents.find((event) => event.type === 'tool_call_decision');
    expect(decision).toBeDefined();
    if (!decision || decision.type !== 'tool_call_decision') {
      throw new Error('expected tool_call_decision event');
    }
    expect(decision.payload?.provider_continuations).toEqual(providerContinuations);
    expect(decision.payload?.assistant_replay_parts).toEqual(assistantReplayParts);
    expect(decision.meta).not.toHaveProperty('displayOptions');
    expect(ctx.decision).toEqual({
      kind: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
        },
      ],
    });
  });

  it('最终回答事件应保留 LLM 响应中的 provider_continuations', async () => {
    const providerContinuations = providerContinuation('Need a careful answer.');
    const assistantReplayParts = [{
      type: 'text' as const,
      text: '最终回答。',
      provider_continuations: providerContinuations,
    }];
    const emittedEvents: TickEvent[] = [];
    const ctx = createTestTickPipelineContext({
      context: {
        llmResp: {
          content: '最终回答。',
          provider_continuations: providerContinuations,
          assistant_replay_parts: assistantReplayParts,
        },
        eventHandler: (event) => emittedEvents.push(event),
      },
    });

    await runTickPipeline(ctx, [createBuildDecisionStage()]);

    const finalAnswer = emittedEvents.find((event) => event.type === 'final_answer');
    expect(finalAnswer).toBeDefined();
    if (!finalAnswer || finalAnswer.type !== 'final_answer') {
      throw new Error('expected final_answer event');
    }
    expect(finalAnswer.provider_continuations).toEqual(providerContinuations);
    expect(finalAnswer.assistant_replay_parts).toEqual(assistantReplayParts);
    expect(finalAnswer.answer_id).not.toBe('');
  });

  it('流式模式下无工具调用但有文本响应时应落成 final_answer 决策', async () => {
    const emittedEvents: TickEvent[] = [];
    const ctx = createTestTickPipelineContext({
      context: {
        llmResp: {
          content: '这是流式调用聚合后的最终回答。',
        },
        eventHandler: (event) => emittedEvents.push(event),
      },
    });

    await runTickPipeline(ctx, [createBuildDecisionStage()]);

    expect(ctx.decision).toEqual({
      kind: 'final_answer',
      answer: '这是流式调用聚合后的最终回答。',
    });
    const finalAnswer = emittedEvents.find((event) => event.type === 'final_answer');
    expect(finalAnswer).toMatchObject({
      type: 'final_answer',
      answer: '这是流式调用聚合后的最终回答。',
      answer_id: expect.any(String),
    });
  });

  it('整批工具调用必须都具备正式身份，不能只校验 primary', async () => {
    const ctx = createTestTickPipelineContext({
      context: {
        llmResp: {
          content: '',
          tool_calls: [
            {
              id: 'call_primary',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{}' },
            },
            {
              id: '',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{}' },
            },
          ],
        },
      },
    });

    await expect(runTickPipeline(ctx, [createBuildDecisionStage()])).rejects.toThrow('tool_calls[1].id');
    expect(ctx.decision).toBeUndefined();
  });
});
