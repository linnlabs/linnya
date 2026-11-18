import { afterEach, describe, expect, it } from 'vitest';
import { AskTool } from 'src/tools/agent_control/ask/AskTool';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

const ASK_ARGUMENTS = { questions: [{ id: 'answer', type: 'text', question: '用哪个城市？' }] };

/** 等待用户回答时插话：不代替回答；回答后同批工具做完，再在回到模型前送达。 */
describe('Flow steer while awaiting user', () => {
  let scenario: FlowScenario | undefined;

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('提问和查询同批：等回答时插话，回答后先跑完查询，再把插话送到下一次模型调用', async () => {
    scenario = await createFlowScenario({
      model: [
        { toolCalls: [{ name: 'ask', arguments: ASK_ARGUMENTS }, { name: 'lookup' }] },
        { contentChunks: ['按上海查好了。'] },
      ],
      tools: { lookup: () => '天气晴' },
      productTools: [new AskTool()],
    });

    const waiting = await scenario.send('查一下天气');
    expect(waiting.status).toBe('awaiting_user');
    expect((await scenario.steer('顺便看看明天')).accepted).toBe(true);

    expect(await scenario.respond('上海')).toMatchObject({ status: 'completed', undeliveredSteers: [] });
    expect(await scenario.timeline({ types: ['tool_output', 'user_input', 'final_answer'] })).toEqual([
      'user "查一下天气"',
      expect.stringMatching(/^result ask#call_1_1 success/),
      'result lookup#call_1_2 success "天气晴"',
      'steer "顺便看看明天"',
      'answer "按上海查好了。"',
    ]);
    await scenario.assertInvariants();
  });
});
