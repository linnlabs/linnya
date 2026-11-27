import { describe, expect, it } from 'vitest';
import { ConversationThoughtMessageMetadataSchema, type ConversationAgentWorkOutcome } from '@app/schemas';
import type { BaseMessage, ThoughtMessage, ToolCallMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { projectConversationVisualRows } from '../../../ui/conversationView/logic/projectConversationVisualRows';
import type { ConversationVisualRow } from '../../../ui/messageCanvas';
import { projectTurnWorkFolds, type TurnWorkFoldProjectionInput } from '../functions/projectTurnWorkFolds';

const RUN = 'run-1';

function rootUser(id: string, outcome?: ConversationAgentWorkOutcome): BaseMessage {
  return createTestUserMessage({
    id,
    metadata: {
      run_id: RUN,
      ...(outcome ? { agent_work: { duration_ms: 341_000, ended_at: 9, outcome } } : {}),
    },
  });
}

function thought(id: string): ThoughtMessage {
  return {
    id, role: 'assistant', type: 'thought', content: '想', timestamp: 2,
    metadata: ConversationThoughtMessageMetadataSchema.parse({
      turn_id: 't', run_id: RUN, is_complete: true, thought_started_at: 1, thought_completed_at: 2,
    }),
  };
}

function tool(id: string, name = 'web_search'): ToolCallMessage {
  return createTestToolMessage({ id, metadata: { tool_name: name, run_id: RUN } });
}

const preamble = (id: string) => createTestAnswerMessage({ id, type: 'tool_preamble', metadata: { run_id: RUN } });
const answer = (id: string) => createTestAnswerMessage({ id, metadata: { run_id: RUN } });

function project(
  messages: readonly BaseMessage[],
  overrides: Partial<TurnWorkFoldProjectionInput> = {},
): ConversationVisualRow[] {
  return projectTurnWorkFolds({
    rows: projectConversationVisualRows(messages),
    busyRunIds: new Set(),
    isExpanded: () => false,
    isDeliverableTool: message => message.metadata.tool_name === 'generate_image',
    foldRowEstimatedHeight: 56,
    ...overrides,
  });
}

function describeRows(rows: readonly ConversationVisualRow[]): string[] {
  return rows.map(row => {
    const id = row.kind === 'turn-work-fold' ? `fold:${row.fold.durationMs}` : row.payload.id;
    return `${id}${row.isTurnStart ? '^' : ''}${row.isTurnEnd ? '$' : ''}`;
  });
}

describe('终态折叠投影', () => {
  const completedTurn = [
    rootUser('u1', 'completed'), thought('th1'), preamble('p1'), tool('s1'), thought('th2'), answer('a1'),
  ];

  it('正常结束且有最终回答：思考、叙述、工具收成一行“已工作”，点开后原样展开', () => {
    expect(describeRows(project(completedTurn))).toEqual(['u1^', 'fold:341000', 'a1$']);

    const expanded = project(completedTurn, { isExpanded: id => id === 'u1' });
    expect(describeRows(expanded)).toEqual(['u1^', 'fold:341000', 'th1', 'p1', 's1', 'th2', 'a1$']);
    const fold = expanded[1];
    expect(fold?.kind === 'turn-work-fold' && fold.fold.expanded).toBe(true);
  });

  it('运行中、暂停中、失败、停止或没有结算时长的轮次保持透明', () => {
    const full = ['u1^', 'th1', 'p1', 's1', 'th2', 'a1$'];
    expect(describeRows(project(completedTurn, { busyRunIds: new Set([RUN]) }))).toEqual(full);
    const failed = [rootUser('u1', 'failed'), ...completedTurn.slice(1)];
    expect(describeRows(project(failed))).toEqual(full);
    // 历史轮次没有 agent_work：不知道是否正常结束，也写不出时长。
    const unknown = [rootUser('u1'), ...completedTurn.slice(1)];
    expect(describeRows(project(unknown))).toEqual(full);
    // 停止后没有最终回答。
    const stopped = [rootUser('u1', 'completed'), thought('th1'), tool('s1')];
    expect(describeRows(project(stopped))).toEqual(['u1^', 'th1', 's1$']);
    // 没有过程可收（直接回答）时不加折叠行。
    expect(describeRows(project([rootUser('u1', 'completed'), answer('a1')]))).toEqual(['u1^', 'a1$']);
  });

  it('运行中途的插话和生成的图片留在外面，轮次首尾按留下的行重算', () => {
    const steer = createTestUserMessage({ id: 'steer', metadata: { run_id: RUN, delivery: 'mid_run' } });
    const rows = project([
      rootUser('u1', 'completed'), thought('th1'), tool('s1'),
      steer, tool('img', 'generate_image'), thought('th2'), answer('a1'),
      rootUser('u2', 'completed'), answer('a2'),
    ]);
    // 插话开启新的视觉轮次；第一轮只剩用户消息和折叠行，折叠行成为它的结尾。
    expect(describeRows(rows)).toEqual(['u1^', 'fold:341000$', 'steer^', 'img', 'a1$', 'u2^', 'a2$']);
  });

  it('内容没变时复用上一次的行对象，流式输出不让整屏行组件重渲染', () => {
    // 增量 builder 在流式输出时保持未变行与轮次上下文的对象身份；折叠投影要把这份稳定性传下去。
    const messageRows = projectConversationVisualRows(completedTurn);
    const input: TurnWorkFoldProjectionInput = {
      rows: messageRows,
      busyRunIds: new Set(),
      isExpanded: () => false,
      isDeliverableTool: () => false,
      foldRowEstimatedHeight: 56,
    };
    const first = projectTurnWorkFolds(input);
    const second = projectTurnWorkFolds({ ...input, previousRows: new Map(first.map(row => [row.key, row] as const)) });
    expect(second).toEqual(first);
    second.forEach((row, index) => expect(row).toBe(first[index]));
  });
});
