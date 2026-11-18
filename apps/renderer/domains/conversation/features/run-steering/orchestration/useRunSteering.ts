import { computed, watch, type Ref } from 'vue';

import type { InteractiveRunSnapshot } from '../../interactive-run/definitions/interactiveRun';
import { isInteractiveRunBusy } from '../../interactive-run/functions/interactiveRunTransitions';
import { useInteractiveRunStore } from '../../interactive-run/store/interactiveRunStore';
import { readConversationLiveMessages } from '../../../message-window';
import { requestRunSteer, requestSteerDrain, requestSteerWithdraw } from './runSteeringApi';
import { useRunSteeringStore, type RunSteerItem } from '../store/runSteeringStore';

/** Host 只在这些状态接纳插话；starting/submitting 时运行还没有身份，先在本地排队。 */
const STEERABLE = new Set<InteractiveRunSnapshot['status']>(['running', 'awaiting_user', 'continuing']);
/** 运行停下后，Host 里没送达的插话要取回。 */
const STOPPED = new Set<InteractiveRunSnapshot['status']>(['completed', 'failed', 'cancelled', 'paused']);

function createInputId(): string {
  return `evt_steer_${crypto.randomUUID()}`;
}

function appendDraft(current: string, addition: string): string {
  const trimmed = current.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${addition}` : addition;
}

/**
 * 运行中插话（Proposal：回车就是插话，整批工具做完后送达，留在同一次运行里）。
 *
 * - 运行正常结束时还没送达的：第一条作为新消息发出，其余在新运行开始后接着作为插话交给它；
 * - 暂停、失败或取消：回到输入框，不自动发；
 * - 立即打断：先暂停，再把待送达的作为新消息发出。
 */
export function useRunSteering(input: {
  readonly conversationId: Readonly<Ref<string | null>>;
  readonly readDraft: () => string;
  readonly writeDraft: (text: string) => void;
  readonly sendAsNewMessage: (text: string) => Promise<unknown>;
  readonly pauseRun: (conversationId: string) => Promise<void>;
}) {
  const store = useRunSteeringStore();
  const runs = useInteractiveRunStore();
  const interruptRequested = new Set<string>();
  const flushing = new Set<string>();
  const flushAgain = new Set<string>();
  /** 第一条已转成新消息：记下当时的运行，其余条目等新运行出现后再交给它。 */
  const awaitingNewRun = new Map<string, string | undefined>();

  const items = computed<readonly RunSteerItem[]>(() => store.itemsFor(input.conversationId.value));
  const run = computed(() => runs.snapshotFor(input.conversationId.value));

  async function flush(conversationId: string): Promise<void> {
    if (flushing.has(conversationId)) {
      flushAgain.add(conversationId);
      return;
    }
    flushing.add(conversationId);
    try {
      const snapshot = runs.snapshotFor(conversationId);
      if (awaitingNewRun.has(conversationId)) {
        if (!snapshot?.runId || snapshot.runId === awaitingNewRun.get(conversationId)) return;
        awaitingNewRun.delete(conversationId);
      }
      const queued = store.itemsFor(conversationId).filter(item => item.state === 'queued');
      if (queued.length === 0) return;

      if (snapshot?.runId && STEERABLE.has(snapshot.status)) {
        for (const item of queued) {
          store.update(conversationId, item.inputId, { state: 'sending', runId: snapshot.runId });
          try {
            const result = await requestRunSteer({
              runId: snapshot.runId,
              conversationId,
              inputId: item.inputId,
              content: item.content,
            });
            store.update(conversationId, item.inputId, result.accepted
              ? { state: 'pending' }
              : { state: 'queued', runId: undefined });
            if (!result.accepted) break;
          } catch (error) {
            console.error('[RunSteering] 插话提交失败，留在本地等下一次机会:', error);
            store.update(conversationId, item.inputId, { state: 'queued', runId: undefined });
            break;
          }
        }
        return;
      }

      // 运行还在启动或收口：等状态稳定后再处理。暂停要等收口完成，新消息才能替代它。
      if (isInteractiveRunBusy(snapshot)) return;
      if (snapshot?.status === 'paused' && !snapshot.pause?.settled) return;

      const interrupt = interruptRequested.delete(conversationId);
      if (interrupt || !snapshot || snapshot.status === 'completed') {
        // 第一条另起一次运行；其余留在本地，等新运行有了身份后作为插话交给它。
        const [first] = queued;
        store.remove(conversationId, [first.inputId]);
        awaitingNewRun.set(conversationId, snapshot?.runId);
        void input.sendAsNewMessage(first.content).catch((error: unknown) => {
          console.error('[RunSteering] 待送达消息转为新消息失败，连同其余的放回输入框:', error);
          awaitingNewRun.delete(conversationId);
          const rest = store.itemsFor(conversationId).filter(item => item.state === 'queued');
          store.remove(conversationId, rest.map(item => item.inputId));
          input.writeDraft(appendDraft(
            input.readDraft(),
            [first, ...rest].map(item => item.content).join('\n\n'),
          ));
        });
        return;
      }

      // 暂停、失败或取消：回到输入框，不自动发出。
      store.remove(conversationId, queued.map(item => item.inputId));
      input.writeDraft(appendDraft(input.readDraft(), queued.map(item => item.content).join('\n\n')));
    } finally {
      flushing.delete(conversationId);
      if (flushAgain.delete(conversationId)) void flush(conversationId);
    }
  }

  /** 运行停下后从 Host 取回没送达的；没取回的就是已经送达（或已撤回）。 */
  async function reclaim(conversationId: string, runId: string): Promise<void> {
    const sent = store.itemsFor(conversationId).filter(item =>
      item.runId === runId && item.state !== 'queued');
    if (sent.length === 0) return;
    try {
      const drained = await requestSteerDrain({ runId, conversationId });
      const returned = new Set(drained.inputs.map(entry => entry.input_id));
      for (const item of sent) {
        if (returned.has(item.inputId)) store.update(conversationId, item.inputId, { state: 'queued', runId: undefined });
      }
      store.remove(conversationId, sent.filter(item => !returned.has(item.inputId)).map(item => item.inputId));
    } catch (error) {
      console.error('[RunSteering] 取回待送达插话失败:', error);
    }
  }

  async function submit(text: string): Promise<void> {
    const conversationId = input.conversationId.value;
    const content = text.trim();
    if (!conversationId || content.length === 0) return;
    store.add(conversationId, { inputId: createInputId(), content, state: 'queued' });
    await flush(conversationId);
  }

  async function withdraw(inputId: string): Promise<'withdrawn' | 'delivered'> {
    const conversationId = input.conversationId.value;
    const item = items.value.find(entry => entry.inputId === inputId);
    if (!conversationId || !item) return 'withdrawn';
    if (item.state === 'queued' || !item.runId) {
      store.remove(conversationId, [inputId]);
      return 'withdrawn';
    }
    const result = await requestSteerWithdraw({ runId: item.runId, conversationId, inputId });
    if (result.outcome === 'delivered') return 'delivered';
    store.remove(conversationId, [inputId]);
    return 'withdrawn';
  }

  /** 编辑 = 撤回后放回输入框改完再发；已经送达的不能再编辑。 */
  async function edit(inputId: string): Promise<void> {
    const item = items.value.find(entry => entry.inputId === inputId);
    if (!item) return;
    if (await withdraw(inputId) === 'withdrawn') {
      input.writeDraft(appendDraft(input.readDraft(), item.content));
    }
  }

  async function interrupt(): Promise<void> {
    const conversationId = input.conversationId.value;
    if (!conversationId || items.value.length === 0) return;
    interruptRequested.add(conversationId);
    try {
      await input.pauseRun(conversationId);
    } catch (error) {
      interruptRequested.delete(conversationId);
      throw error;
    }
  }

  // 运行状态变化：有身份后提交排队的插话；停下后取回没送达的，再按结束方式处理。
  watch(
    () => [input.conversationId.value, run.value?.status, run.value?.runId, run.value?.pause?.settled] as const,
    async ([conversationId, status, runId], previous) => {
      if (!conversationId) return;
      const previousRunId = previous?.[0] === conversationId ? previous?.[2] : undefined;
      if (status && STOPPED.has(status)) {
        const stoppedRunId = runId ?? previousRunId;
        if (stoppedRunId) await reclaim(conversationId, stoppedRunId);
      }
      await flush(conversationId);
    },
  );

  // 送达后，插话作为用户消息出现在时间线上，待送达条里同时去掉。
  watch(
    () => {
      const conversationId = input.conversationId.value;
      if (!conversationId || items.value.length === 0) return [] as string[];
      const pending = new Set(items.value.map(item => item.inputId));
      return readConversationLiveMessages(conversationId)
        .filter(message => pending.has(message.id))
        .map(message => message.id);
    },
    deliveredIds => {
      const conversationId = input.conversationId.value;
      if (conversationId && deliveredIds.length > 0) store.remove(conversationId, deliveredIds);
    },
  );

  return { items, submit, withdraw, edit, interrupt };
}
