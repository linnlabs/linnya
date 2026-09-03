import { describe, expect, it } from 'vitest';
import type { CanonicalInferencePort } from '../../ports';
import { defineAgent } from '../defineAgent';
import { defineConfig } from '../defineConfig';
import { runAgent } from '../runAgent';

function createScriptedInference(answer: string): CanonicalInferencePort {
  return {
    async *stream(request) {
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      yield { type: 'answer_delta', text: answer };
      yield {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
      };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

describe('quickstart helpers', () => {
  it('defineAgent 补齐最小 AgentSpec，并默认使用 agent profile', () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
    });

    expect(agent.spec.id).toBe('hello');
    expect(agent.spec.version).toBe('0.0.0');
    expect(agent.spec.contextPolicy.profileId).toBe('agent');
    expect(agent.tools).toEqual([]);
  });

  it('defineConfig 拒绝重复 agent id', () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
    });

    expect(() =>
      defineConfig({
        agents: [agent, agent],
        inference: createScriptedInference('ok'),
      }),
    ).toThrow(/duplicate agent id/);
  });

  it('runAgent 用内存 runtime 跑通 hello agent', async () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
      modelId: 'scripted',
    });
    const seen: string[] = [];

    const result = await runAgent(agent, {
      input: 'hi',
      inference: createScriptedInference('hello back'),
      onEvent: (event) => {
        seen.push(event.type);
      },
    });

    expect(result.runId).toMatch(/^run[-_]/);
    expect(result.finalAnswer).toBe('hello back');
    expect(result.cost.tokensInput).toBe(3);
    expect(result.cost.tokensOutput).toBe(2);
    expect(result.events.some((event) => event.type === 'user_input')).toBe(true);
    expect(seen).toContain('final_answer_chunk');
    expect(seen).toEqual(result.events.map((event) => event.type));
    for (const event of result.events) {
      expect(event).toMatchObject({
        run_id: result.runId,
        lane: 'foreground',
        visibility: 'conversation',
      });
    }
    expect(result.contextTrace).toMatchObject({
      kind: 'quickstart_context_trace',
      builder: 'QuickstartContextBuilder',
      contextPolicyExecution: {
        mode: 'quickstart_minimal',
        executed: false,
      },
    });
  });

  it('runAgent 应让 maxSteps 显式覆盖 quickstart 默认步数', async () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
      modelId: 'scripted',
    });

    const result = await runAgent(agent, {
      input: 'hi',
      inference: createScriptedInference('hello back'),
      maxSteps: 2,
    });

    expect(result.finalAnswer).toBe('hello back');
    expect(result.cost.tokensInput).toBe(3);
    expect(result.cost.tokensOutput).toBe(2);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user_input',
        }),
      ]),
    );
  });

  it('defineAgent 的 contextPolicy 在 quickstart trace 中标记为声明但未执行', async () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
      modelId: 'scripted',
      contextPolicy: {
        budget: { maxTokens: 1024 },
        compaction: { triggerRatio: 0.8, targetRatio: 0.5 },
        contextTrace: { enabled: true },
      },
    });

    const result = await runAgent(agent, {
      input: 'hi',
      inference: createScriptedInference('hello back'),
    });

    expect(result.contextTrace).toMatchObject({
      kind: 'quickstart_context_trace',
      contextPolicyExecution: {
        executed: false,
        declaredUnsupportedFields: expect.arrayContaining([
          'budget',
          'compaction',
          'contextTrace',
        ]),
      },
    });
  });

  it('runAgent resolves after async chunk onEvent handlers finish', async () => {
    const agent = defineAgent({
      id: 'hello',
      systemPrompt: 'You are helpful.',
      modelId: 'scripted',
    });
    const flushed: string[] = [];

    await runAgent(agent, {
      input: 'hi',
      inference: createScriptedInference('hello back'),
      onEvent: async (event) => {
        if (event.type !== 'final_answer_chunk') return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        flushed.push(event.content);
      },
    });

    expect(flushed).toEqual(['hello back']);
  });
});
