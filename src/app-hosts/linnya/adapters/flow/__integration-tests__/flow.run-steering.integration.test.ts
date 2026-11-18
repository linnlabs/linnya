import { afterEach, describe, expect, it } from 'vitest';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

const search = (...queries: string[]): ScriptedLlmTurn => ({
  toolCalls: queries.map(query => ({ name: 'lookup', arguments: { query } })),
});
const answer = (text: string): ScriptedLlmTurn => ({ contentChunks: [text] });

describe('Flow run steering integration', () => {
  let scenario: FlowScenario | undefined;

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('工具执行中插话：整批结束后送达，实时、重载、下一次模型请求和下一轮对话都看到它', async () => {
    let steer: { accepted: boolean; inputId: string } | undefined;
    scenario = await createFlowScenario({
      model: [
        search('人工智能'),
        {
          ...answer('人工智能和机器学习都查过了。'),
          // 送达后不能再撤回。
          assertCall: async () => { expect(await scenario!.withdraw(steer?.inputId ?? '')).toBe('delivered'); },
        },
        answer('两个方向都查过了。'),
      ],
      tools: {
        lookup: async ({ args }) => {
          steer = await scenario!.steer('顺便也看看机器学习。');
          return `搜索结果：${String(args.query)}`;
        },
      },
    });

    const first = await scenario.send('先搜索一下人工智能，再告诉我结果。');
    await scenario.send('用一句话总结一下。');

    expect(steer?.accepted).toBe(true);
    expect(first.undeliveredSteers).toEqual([]);
    // 实时通道只推送运行中送达的插话；起点输入由客户端自己先显示，不回传。
    expect(scenario.realtime.filter(event => event.type === 'user_input'))
      .toMatchObject([{ id: steer?.inputId, delivery: 'mid_run' }]);
    expect(await scenario.timeline({ types: ['user_input', 'tool_output', 'final_answer'] })).toEqual([
      'user "先搜索一下人工智能，再告诉我结果。"',
      'result lookup#call_1_1 success "搜索结果：人工智能"',
      'steer "顺便也看看机器学习。"',
      'answer "人工智能和机器学习都查过了。"',
      'user "用一句话总结一下。"',
      'answer "两个方向都查过了。"',
    ]);
    await scenario.assertInvariants();
    scenario.fixture.ai.assertAllTurnsConsumed();
  });

  it('最后一次模型调用期间的插话不送达，运行停下后取回；运行结束后再插话不被接纳', async () => {
    scenario = await createFlowScenario({
      model: [{ ...answer('这是直接的回答。'), assertCall: async () => { await scenario!.steer('再补充一个例子。'); } }],
    });

    const run = await scenario.send('直接回答我。');

    expect(run).toMatchObject({ status: 'completed', undeliveredSteers: ['再补充一个例子。'] });
    await expect(scenario.fixture.flow.steerRun(run.runId, {
      conversation_id: scenario.conversationId,
      input_id: 'evt_steer_after_end',
      content: '运行结束后',
    })).resolves.toEqual({ success: true, accepted: false });
    await scenario.assertInvariants();
  });

  it('同一批两个工具各插一句：按提交顺序在整批之后送达，下一轮各看到一次', async () => {
    scenario = await createFlowScenario({
      model: [search('甲', '乙'), answer('都查了。'), answer('总结。')],
      tools: { lookup: async ({ args }) => { await scenario!.steer(`补充${String(args.query)}`); return 'ok'; } },
    });

    await scenario.send('查甲和乙');
    await scenario.send('总结一下');

    expect((await scenario.timeline()).filter(line => line.startsWith('steer'))).toEqual(['steer "补充甲"', 'steer "补充乙"']);
    await scenario.assertInvariants();
  });

  it('送达前撤回：不送达，运行停下后也不会被取回', async () => {
    scenario = await createFlowScenario({
      model: [search('x'), answer('done')],
      tools: {
        lookup: async () => {
          const { inputId } = await scenario!.steer('算了');
          expect(await scenario!.withdraw(inputId)).toBe('withdrawn');
          return 'ok';
        },
      },
    });

    const run = await scenario.send('go');

    expect(run.undeliveredSteers).toEqual([]);
    expect((await scenario.timeline()).some(line => line.startsWith('steer'))).toBe(false);
    await scenario.assertInvariants();
  });

  it('工具执行中插话后暂停：插话取回，继续后完成剩下的回答', async () => {
    scenario = await createFlowScenario({
      model: [search('x'), answer('继续后的回答')],
      tools: {
        lookup: async () => {
          await scenario!.steer('暂停前写的');
          await scenario!.pause();
          return 'ok';
        },
      },
    });

    const paused = await scenario.send('go');
    expect(paused).toMatchObject({ status: 'paused', undeliveredSteers: ['暂停前写的'] });

    expect((await scenario.continue()).status).toBe('completed');
    expect((await scenario.timeline()).slice(-1)).toEqual(['answer "继续后的回答"']);
    await scenario.assertInvariants();
  });

  it('工具报错时插话仍排在错误结果之后送达', async () => {
    scenario = await createFlowScenario({
      model: [search('x'), answer('换个办法')],
      tools: { lookup: async () => { await scenario!.steer('那就换个关键词'); return { error: 'network down' }; } },
    });

    await scenario.send('go');

    expect(await scenario.timeline({ types: ['tool_output', 'user_input'] })).toEqual([
      'user "go"',
      expect.stringMatching(/^result lookup#call_1_1 error/),
      'steer "那就换个关键词"',
    ]);
    await scenario.assertInvariants();
  });
});
