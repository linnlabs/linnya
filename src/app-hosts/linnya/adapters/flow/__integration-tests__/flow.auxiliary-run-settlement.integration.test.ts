import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys, type ConversationNextRequest } from '@app/schemas';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { BaseTool } from 'src/tools/types';

const conversationId = 'auxiliary-settlement-conversation';
const firstTurn: ConversationNextRequest = {
  conversation_id: conversationId,
  new_events: [{ type: 'user_input', content: 'Plan the launch', source: 'user', timestamp: 1 }],
  options: { promptKey: 'default', model_id: 'scripted-test-model' },
};
/** 与 Renderer 自动生成对话标题的请求同形：不落库、辅助通道、单独的 turn。 */
const titleRequest: ConversationNextRequest = {
  conversation_id: conversationId,
  new_events: [{ type: 'user_input', content: 'Title for: Plan the launch', source: 'user', timestamp: 2 }],
  options: {
    promptKey: PromptKeys.CONVERSATION_TITLE,
    model_id: 'scripted-test-model',
    turn_id: 'conversation_title:generation-1',
    run_lane: 'auxiliary',
  },
};

let directory: string;
let close: (() => void) | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-auxiliary-settlement-'));
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  close?.();
  close = undefined;
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

type Harness = Awaited<ReturnType<typeof createDurableFlowHarness>>;

async function open(
  turns: Parameters<typeof createDurableFlowHarness>[1],
  tools: Parameters<typeof createDurableFlowHarness>[2] = [],
): Promise<Harness> {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns, tools);
  close = fixture.close;
  return fixture;
}

/** 不落库运行结束后的三项事实：runs 终态、SSE 里没有失败事件、SQLite 不留断点。 */
function readSettledFacts(fixture: Harness, eventTypes: readonly string[]) {
  return {
    runs: fixture.db.prepare('SELECT agent_spec_id, status, error_json FROM runs ORDER BY start_ts, rowid').all(),
    errorEvents: eventTypes.filter(type => type === 'error').length,
    checkpoints: fixture.db.prepare('SELECT count(*) AS count FROM engine_checkpoints').get(),
  };
}

describe('不落库的运行结算（生产恢复装配）', () => {
  it('生成标题的辅助运行正常结束：记为完成、不发失败事实、不留断点', async () => {
    const fixture = await open([{ contentChunks: ['Launch plan ready.'] }, { contentChunks: ['Launch plan'] }]);
    await fixture.flow.next(firstTurn, () => {});

    const eventTypes: string[] = [];
    await fixture.flow.next(titleRequest, event => { eventTypes.push(event.type); }, undefined, { persist: false });

    expect(readSettledFacts(fixture, eventTypes)).toEqual({
      runs: [
        { agent_spec_id: expect.any(String), status: 'completed', error_json: null },
        { agent_spec_id: PromptKeys.CONVERSATION_TITLE, status: 'completed', error_json: null },
      ],
      errorEvents: 0,
      checkpoints: { count: 0 },
    });
  });

  // 文档审阅这类不落库运行会调工具、走多轮模型，断点在轮次之间写入，结束时同样要释放。
  it('带工具的多步不落库运行正常结束：记为完成、不发失败事实、不留断点', async () => {
    class ReadFixture extends BaseTool {
      readonly name = 'read_file';
      readonly description = 'Read fixture';
      readonly parameters = { type: 'object' as const, properties: {}, required: [] };
      async run(): Promise<string> {
        return JSON.stringify({ data: { ok: true }, observation: 'Fixture content' });
      }
    }
    const fixture = await open(
      [
        { contentChunks: ['Ready.'] },
        { toolCalls: [{ id: 'read-review-source', name: 'read_file', argumentsJson: '{}' }] },
        { contentChunks: ['Review finished.'] },
      ],
      [new ReadFixture()],
    );
    await fixture.flow.next(firstTurn, () => {});

    const eventTypes: string[] = [];
    await fixture.flow.next({
      ...firstTurn,
      new_events: [{ type: 'user_input', content: 'Review the document', source: 'user', timestamp: 2 }],
    }, event => { eventTypes.push(event.type); }, undefined, { persist: false });

    expect(fixture.getToolExecutions()).toHaveLength(1);
    expect(readSettledFacts(fixture, eventTypes)).toEqual({
      runs: [
        { agent_spec_id: expect.any(String), status: 'completed', error_json: null },
        { agent_spec_id: expect.any(String), status: 'completed', error_json: null },
      ],
      errorEvents: 0,
      checkpoints: { count: 0 },
    });
  });
});
