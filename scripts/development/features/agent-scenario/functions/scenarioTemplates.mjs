/** `scenario new` 生成的骨架：一个最小可运行的 Flow 场景，改脚本和断言即可。 */
function titleOf(name) {
  return name.replace(/-/g, ' ');
}

export function scenarioTestPath(name) {
  return `src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.${name}.scenario.integration.test.ts`;
}

export function renderScenarioTest(name) {
  return `import { afterEach, describe, expect, it } from 'vitest';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

describe('${titleOf(name)}', () => {
  let scenario: FlowScenario | undefined;

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('TODO: 一句话写清楚要证明的行为', async () => {
    scenario = await createFlowScenario({
      model: [
        { toolCalls: [{ name: 'lookup', arguments: { q: 'x' } }] },
        { contentChunks: ['done'] },
      ],
      // 工具和模型脚本里可以 await scenario!.steer() / withdraw() / pause()，表示“这一刻”用户的动作。
      tools: { lookup: async () => 'result' },
    });

    expect((await scenario.send('go')).status).toBe('completed');
    expect(await scenario.timeline({ types: ['user_input', 'tool_output', 'final_answer'] })).toEqual([
      'user "go"',
      'result lookup#call_1_1 success "result"',
      'answer "done"',
    ]);
    await scenario.assertInvariants();
  });
});
`;
}
