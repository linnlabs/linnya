import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, ref, type EffectScope } from 'vue';

import type { InteractiveRunSnapshot } from '../../interactive-run/definitions/interactiveRun';

const runSnapshots = ref<Record<string, InteractiveRunSnapshot>>({});
vi.mock('../../interactive-run/store/interactiveRunStore', () => ({
  useInteractiveRunStore: () => ({
    snapshotFor: (conversationId: string | null | undefined) =>
      conversationId ? runSnapshots.value[conversationId] : undefined,
  }),
}));
vi.mock('../../../message-window', () => ({
  readConversationLiveMessages: () => [],
}));
const api = vi.hoisted(() => ({
  requestRunSteer: vi.fn(),
  requestSteerDrain: vi.fn(),
  requestSteerWithdraw: vi.fn(),
}));
vi.mock('./runSteeringApi', () => api);

import { useRunSteering } from './useRunSteering';
import { useRunSteeringStore } from '../store/runSteeringStore';

const CONVERSATION = 'conv_1';

function setRun(runId: string, status: InteractiveRunSnapshot['status']): void {
  runSnapshots.value = { [CONVERSATION]: { conversationId: CONVERSATION, runId, status } };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

describe('useRunSteering', () => {
  let scope: EffectScope;
  let draft: string;
  let sendAsNewMessage: ReturnType<typeof vi.fn<(text: string) => Promise<unknown>>>;
  /** Host 侧每次运行收到、还没送达的插话。 */
  let hostPending: Record<string, { input_id: string; content: string; submitted_at: number }[]>;

  function mount() {
    return scope.run(() => useRunSteering({
      conversationId: ref(CONVERSATION),
      readDraft: () => draft,
      writeDraft: text => { draft = text; },
      sendAsNewMessage,
      pauseRun: async () => {},
    }))!;
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
    draft = '';
    hostPending = {};
    runSnapshots.value = {};
    sendAsNewMessage = vi.fn(async () => undefined);
    api.requestRunSteer.mockImplementation(async (input: { runId: string; inputId: string; content: string }) => {
      (hostPending[input.runId] ??= []).push({ input_id: input.inputId, content: input.content, submitted_at: 1 });
      return { success: true, accepted: true, input_id: input.inputId };
    });
    api.requestSteerDrain.mockImplementation(async (input: { runId: string }) => {
      const inputs = hostPending[input.runId] ?? [];
      delete hostPending[input.runId];
      return { success: true, inputs };
    });
  });

  afterEach(() => {
    scope.stop();
    vi.clearAllMocks();
  });

  it('运行结束时没送达的：第一条作为新消息，其余等新运行出现后交给它', async () => {
    setRun('run_0', 'running');
    const steering = mount();
    await steering.submit('补充一');
    await steering.submit('补充二');
    expect(api.requestRunSteer).toHaveBeenCalledTimes(2);

    setRun('run_0', 'completed');
    await settle();
    // 新运行出现前，旧运行的状态可能再通知一次（这里用暂停收口字段模拟）。
    runSnapshots.value = {
      [CONVERSATION]: { conversationId: CONVERSATION, runId: 'run_0', status: 'completed', pause: { settled: true, updatedAt: 2 } },
    };
    await settle();
    expect(sendAsNewMessage).toHaveBeenCalledTimes(1);
    expect(sendAsNewMessage).toHaveBeenCalledWith('补充一');
    // 新运行出现前，第二条不能也被当成新消息发出。
    expect(useRunSteeringStore().itemsFor(CONVERSATION)).toMatchObject([{ content: '补充二', state: 'queued' }]);

    setRun('run_1', 'running');
    await settle();
    expect(api.requestRunSteer).toHaveBeenLastCalledWith(expect.objectContaining({ runId: 'run_1', content: '补充二' }));
    expect(useRunSteeringStore().itemsFor(CONVERSATION)).toMatchObject([{ content: '补充二', state: 'pending', runId: 'run_1' }]);

    // 新运行也没有工具批次可以送达：结束后第二条再作为新消息发出。
    setRun('run_1', 'completed');
    await settle();
    expect(sendAsNewMessage).toHaveBeenCalledTimes(2);
    expect(sendAsNewMessage).toHaveBeenLastCalledWith('补充二');
    expect(useRunSteeringStore().itemsFor(CONVERSATION)).toEqual([]);
    expect(draft).toBe('');
  });

  it('转为新消息失败时，连同其余没送达的按顺序放回输入框', async () => {
    sendAsNewMessage.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    draft = '正在写的';
    setRun('run_0', 'running');
    const steering = mount();
    await steering.submit('补充一');
    await steering.submit('补充二');

    setRun('run_0', 'completed');
    await settle();

    expect(sendAsNewMessage).toHaveBeenCalledTimes(1);
    expect(draft).toBe('正在写的\n\n补充一\n\n补充二');
    expect(useRunSteeringStore().itemsFor(CONVERSATION)).toEqual([]);
  });

  it('暂停后没送达的回到输入框，不自动发出', async () => {
    setRun('run_0', 'running');
    const steering = mount();
    await steering.submit('补充一');

    runSnapshots.value = {
      [CONVERSATION]: { conversationId: CONVERSATION, runId: 'run_0', status: 'paused', pause: { settled: true, updatedAt: 1 } },
    };
    await settle();

    expect(sendAsNewMessage).not.toHaveBeenCalled();
    expect(draft).toBe('补充一');
    expect(useRunSteeringStore().itemsFor(CONVERSATION)).toEqual([]);
  });
});
