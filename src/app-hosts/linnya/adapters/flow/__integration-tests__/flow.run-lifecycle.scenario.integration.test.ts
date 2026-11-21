import { afterEach, describe, expect, it } from 'vitest';
import { SqliteRunCostStateStore } from '../../token-accounting/collectors/sqliteRunCostStateStore';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

/** 运行生命周期：生产装配下每种结束方式都进入正确终态，并满足运行不变量（assertInvariants 内含）。 */
describe('Flow run lifecycle', () => {
  let scenario: FlowScenario | undefined;

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('直接回答：完成，用量写入持久账本', async () => {
    scenario = await createFlowScenario({
      model: [{
        contentChunks: ['这是测试回答。'],
        canonicalUsage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, source: 'provider-response-usage', confidence: 'actual' },
      }],
    });

    const run = await scenario.send('请给一个极短回答');

    expect(run.status).toBe('completed');
    expect(new SqliteRunCostStateStore(scenario.fixture.db).load(run.runId)?.tokensOutput).toBe(7);
    await scenario.assertInvariants();
  });

  it('工具报错：错误结果交给模型，运行仍完成', async () => {
    scenario = await createFlowScenario({
      model: [{ toolCalls: [{ name: 'lookup' }] }, { contentChunks: ['工具失败已被协议化处理。'] }],
      tools: { lookup: () => ({ error: 'scenario tool failed' }) },
    });

    expect((await scenario.send('请调用工具然后解释错误')).status).toBe('completed');
    expect(await scenario.timeline({ types: ['tool_output'] })).toEqual([
      expect.stringMatching(/^result lookup#call_1_1 error/),
    ]);
    await scenario.assertInvariants();
  });

  it('模型不可重试失败：持久运行带分类原因暂停，用户可以继续', async () => {
    scenario = await createFlowScenario({
      model: [{ failure: { kind: 'provider', code: 'auth_failed', retryable: false } }],
    });

    const run = await scenario.send('请触发模型失败');

    expect(run.status).toBe('paused');
    expect(run.pauseReason).not.toBe('user_pause');
    await scenario.assertInvariants();
  });

  it('模型调用中取消：运行取消，不再调用模型', async () => {
    scenario = await createFlowScenario({
      model: [{ contentChunks: ['这段不会产出。'], assertCall: async () => { await scenario!.cancel(); } }],
    });

    expect((await scenario.send('请触发取消')).status).toBe('cancelled');
    expect(scenario.modelCalls()).toHaveLength(1);
    await scenario.assertInvariants();
  });
});
