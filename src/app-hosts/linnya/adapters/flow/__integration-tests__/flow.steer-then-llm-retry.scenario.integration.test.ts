import { afterEach, describe, expect, it } from 'vitest';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

describe('steer then llm retry', () => {
  let scenario: FlowScenario | undefined;

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('插话送达后模型调用遇到可重试错误：重试请求里插话仍只出现一次，且只落盘一次', async () => {
    const retryable = Object.assign(new Error('connection reset'), { errorCode: 'llm.provider_down', recoverable: true, retryAfterMs: 0 });
    scenario = await createFlowScenario({
      model: [
        { toolCalls: [{ name: 'lookup' }] },
        { contentChunks: ['半截'], throwAfterEvents: retryable },
        { contentChunks: ['重试后的回答'] },
      ],
      tools: { lookup: async () => { await scenario!.steer('只看今年的'); return 'ok'; } },
    });

    expect((await scenario.send('go')).status).toBe('completed');
    expect(scenario.modelCalls()).toHaveLength(3);
    await scenario.assertInvariants();
  });
});
