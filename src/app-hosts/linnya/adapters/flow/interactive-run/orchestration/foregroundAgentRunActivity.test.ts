import { describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import { createForegroundAgentRunActivity } from './foregroundAgentRunActivity';

type RunRecord = runSupervisor.RunRecord;

function record(overrides: Partial<RunRecord> & Pick<RunRecord, 'runId'>): RunRecord {
  return {
    conversationId: 'conversation-a',
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    metadata: { lane: 'foreground', turnId: 'turn-1', executionId: `exec-${overrides.runId}` },
    ...overrides,
  };
}

const runId = (value: string) => RunIdSchema.parse(value);

async function createHarness(records: readonly RunRecord[]) {
  const registryStore = new runSupervisor.MemoryRunRegistryStore();
  for (const item of records) await registryStore.save(item);
  const supervisor = new runSupervisor.DefaultRunSupervisor({ registryStore });
  const titles = new Map<string, string>([
    ['conversation-a', '整理周报'],
    ['conversation-b', '翻译合同'],
  ]);
  const setStatus = async (id: string, status: RunRecord['status'], patch: Partial<RunRecord> = {}) => {
    const current = await registryStore.load(runId(id));
    if (!current) throw new Error(`missing ${id}`);
    await registryStore.save({ ...current, status, updatedAt: current.updatedAt + 1, ...patch });
  };
  return { registryStore, supervisor, titles, setStatus };
}

describe('createForegroundAgentRunActivity', () => {
  it('只列出 pending/running 的前台根 run，按对话去重并附带标题', async () => {
    const harness = await createHarness([
      record({ runId: runId('root-a'), startedAt: 10 }),
      // 合同异常的第二个前台根仍只产生一项。
      record({ runId: runId('root-a-2'), status: 'pending', startedAt: 11 }),
      record({ runId: runId('child-a'), parentRunId: runId('root-a'), startedAt: 12 }),
      record({
        runId: runId('title-a'),
        startedAt: 13,
        metadata: { lane: 'auxiliary', turnId: 'title-turn' },
      }),
      // 只有 child 或 auxiliary 在跑的对话不算前台任务。
      record({
        runId: runId('child-only'),
        conversationId: 'conversation-c',
        parentRunId: runId('root-c'),
      }),
      record({
        runId: runId('translate-c'),
        conversationId: 'conversation-c',
        metadata: { lane: 'auxiliary', turnId: 'translate' },
      }),
      record({ runId: runId('awaiting-d'), conversationId: 'conversation-d', status: 'awaiting_user' }),
      record({
        runId: runId('paused-e'),
        conversationId: 'conversation-e',
        status: 'paused',
        pausedAt: 5,
      }),
      record({ runId: runId('done-f'), conversationId: 'conversation-f', status: 'completed' }),
      record({ runId: runId('root-b'), conversationId: 'conversation-b', startedAt: 20 }),
      record({ runId: runId('root-g'), conversationId: 'conversation-g', startedAt: 30 }),
    ]);
    const activity = createForegroundAgentRunActivity({
      supervisor: harness.supervisor,
      flow: { pauseRun: vi.fn() },
      readConversationTitle: async id => harness.titles.get(id) ?? null,
    });

    await expect(activity.listActive()).resolves.toEqual([
      { conversationId: 'conversation-a', conversationTitle: '整理周报' },
      { conversationId: 'conversation-b', conversationTitle: '翻译合同' },
      { conversationId: 'conversation-g', conversationTitle: null },
    ]);
  });

  it('暂停全部可暂停 run，报告不可暂停的对话，并容忍并发自然结束', async () => {
    const harness = await createHarness([
      record({ runId: runId('root-a'), startedAt: 1 }),
      record({ runId: runId('root-b'), conversationId: 'conversation-b', startedAt: 2 }),
      record({ runId: runId('root-c'), conversationId: 'conversation-c', startedAt: 3 }),
      record({
        runId: runId('root-d'),
        conversationId: 'conversation-d',
        startedAt: 4,
        metadata: { lane: 'foreground', turnId: 'turn-d' },
      }),
      record({
        runId: runId('title-e'),
        conversationId: 'conversation-e',
        metadata: { lane: 'auxiliary', turnId: 'title' },
      }),
    ]);
    const pauseRun = vi.fn(async (id: string, conversationId: string, executionId: string) => {
      expect(executionId).toBe(`exec-${id}`);
      if (id === 'root-a') {
        await harness.setStatus(id, 'paused', { pausedAt: 9, pauseReason: 'user_pause' });
        return { conversation_id: conversationId, run: null };
      }
      if (id === 'root-b') {
        // 没有恢复输入：与 HTTP pause 相同直接拒绝，run 仍在执行。
        throw new Error('Run has no durable continuation inputs');
      }
      // root-c 在暂停到达前自然完成；pauseRun 可能成功返回也可能拒绝。
      await harness.setStatus(id, 'completed');
      throw new Error('Pause execution identity is stale');
    });
    const activity = createForegroundAgentRunActivity({
      supervisor: harness.supervisor,
      flow: { pauseRun },
      readConversationTitle: async () => null,
    });

    await expect(activity.pauseAll()).resolves.toEqual({
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: ['conversation-b', 'conversation-d'],
    });
    // 缺少 executionId 的 run 不发出暂停；auxiliary 不参与暂停。
    expect(pauseRun.mock.calls.map(call => call[0]).sort()).toEqual(['root-a', 'root-b', 'root-c']);
    // 只暂停，不取消或丢弃。
    expect((await harness.registryStore.load(runId('root-b')))?.status).toBe('running');
    expect((await harness.registryStore.load(runId('title-e')))?.status).toBe('running');
  });

  it('没有执行中的前台 run 时返回空结果', async () => {
    const harness = await createHarness([
      record({ runId: runId('paused-a'), status: 'paused', pausedAt: 3 }),
    ]);
    const pauseRun = vi.fn();
    const activity = createForegroundAgentRunActivity({
      supervisor: harness.supervisor,
      flow: { pauseRun },
      readConversationTitle: async () => null,
    });

    await expect(activity.listActive()).resolves.toEqual([]);
    await expect(activity.pauseAll()).resolves.toEqual({
      pausedConversationIds: [],
      unpausableConversationIds: [],
    });
    expect(pauseRun).not.toHaveBeenCalled();
  });
});
