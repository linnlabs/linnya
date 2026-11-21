import { afterEach, describe, expect, it } from 'vitest';
import { createCommandApprovalHost } from '../../commands/approval-host';
import { createConversationActivityPorts } from '../../persistence/run-registry';
import { readConversationActivity } from '../../../application/conversation-activity';
import { createFlowScenario, type FlowScenario } from '../__test-helpers__/flowScenario';

/** 一直不结束、也不理会停止信号的工具（例如没有接取消的外部请求）。 */
function stuckTool() {
  let release!: (value: string) => void;
  const gate = new Promise<string>(resolve => { release = resolve; });
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  return { running, release, lookup: async () => { started(); return gate; } };
}

describe('工具不理会停止信号', () => {
  let scenario: FlowScenario | undefined;
  const approvals = createCommandApprovalHost();
  approvals.setControlEndpointAvailable(true);

  afterEach(async () => {
    await scenario?.close();
    scenario = undefined;
  });

  it('暂停最多等几秒就停下：侧栏是已中断，同一对话可以继续发消息', async () => {
    const tool = stuckTool();
    scenario = await createFlowScenario({
      model: [
        { toolCalls: [{ name: 'lookup', arguments: { query: 'x' } }] },
        { contentChunks: ['新的回答'] },
      ],
      tools: { lookup: tool.lookup },
    });
    const activity = () => readConversationActivity(
      createConversationActivityPorts(scenario!.fixture.db, approvals),
      scenario!.conversationId,
    );

    const first = scenario.send('先查一下');
    await tool.running;
    const pausedAt = Date.now();
    await scenario.pause();
    expect(await first).toMatchObject({ status: 'paused' });
    expect(Date.now() - pausedAt).toBeLessThan(6_000);
    expect(await activity()).toMatchObject({ state: 'interrupted', pause: { settled: true } });

    // 迟到的结果不写入；新消息取代暂停的运行并正常完成。
    tool.release('迟到的结果');
    expect(await scenario.send('换个问题')).toMatchObject({ status: 'completed' });
    expect((await scenario.timeline()).join('\n')).not.toContain('迟到的结果');
  }, 20_000);
});
