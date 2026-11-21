import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import type { ConversationActivity, ConversationActivityList } from '@app/schemas';

const gateway = vi.hoisted(() => ({
  read: vi.fn<() => Promise<ConversationActivityList>>(),
  listeners: [] as (() => void)[],
}));

vi.mock('../infrastructure/conversationActivityGateway', () => ({
  readConversationActivityList: gateway.read,
  subscribeConversationActivityChanged: (listener: () => void) => {
    gateway.listeners.push(listener);
    return () => gateway.listeners.splice(gateway.listeners.indexOf(listener), 1);
  },
}));

import { useAssistantStore } from '../../../store/assistantStore';
import { useInteractiveRunStore } from '../../interactive-run';
import { useConversationActivitySeenStore } from '../store/conversationActivitySeenStore';
import { useConversationActivityStore } from '../store/conversationActivityStore';
import {
  startConversationActivityLifecycle,
  stopConversationActivityLifecycle,
} from './conversationActivityLifecycle';

function activity(state: ConversationActivity['state'], runId: string, updatedAt = Date.now() + 1000): ConversationActivity {
  return { state, source: 'run_registry', run_id: runId, run_status: null, reason: null, updated_at: updatedAt,
    pause: null, pending_approval_count: 0 };
}

function list(...items: [string, ConversationActivity][]): ConversationActivityList {
  return { conversations: items.map(([id, value]) => ({ conversation_id: id, project_id: null, activity: value })) };
}

/** 等进行中的读取（含补读）和随后的 watch 结束，不额外发起读取。 */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  gateway.read.mockReset();
  gateway.listeners.length = 0;
});

afterEach(() => {
  stopConversationActivityLifecycle();
  vi.unstubAllGlobals();
});

describe('conversationActivityLifecycle', () => {
  it('先订阅再读取；读取期间的多个信号只补读一次', async () => {
    let release!: (value: ConversationActivityList) => void;
    gateway.read.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    gateway.read.mockResolvedValue(list(['a', activity('running', 'r1')]));
    startConversationActivityLifecycle();
    expect(gateway.listeners).toHaveLength(1);
    gateway.listeners[0]!();
    gateway.listeners[0]!();
    release(list());
    await settle();
    expect(gateway.read).toHaveBeenCalledTimes(2);
    expect(useConversationActivityStore().entries.get('a')?.activity.state).toBe('running');
  });

  it('窗口回到前台重读；正在看的对话出现中断当场记为看过', async () => {
    gateway.read.mockResolvedValue(list(['open', activity('interrupted', 'r1')]));
    useAssistantStore().setActiveConversation('open');
    startConversationActivityLifecycle();
    await settle();
    expect(useConversationActivitySeenStore().seenRunIds).toEqual({ open: 'r1' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(gateway.read).toHaveBeenCalledTimes(2);
  });

  it('本窗口发起暂停时先记下运行，收口为中断后不出红点，新运行开始后记录删除', async () => {
    gateway.read.mockResolvedValue(list(['other', activity('running', 'r1')]));
    startConversationActivityLifecycle();
    await settle();
    const runs = useInteractiveRunStore();
    runs.runsByConversation.set('other', { conversationId: 'other', runId: 'r1', status: 'pausing' });
    await nextTick();
    expect(useConversationActivitySeenStore().seenRunIds).toEqual({ other: 'r1' });
    gateway.read.mockResolvedValue(list(['other', activity('interrupted', 'r1')]));
    gateway.listeners[0]!();
    await settle();
    expect(useConversationActivitySeenStore().seenRunIds).toEqual({ other: 'r1' });
    gateway.read.mockResolvedValue(list(['other', activity('running', 'r2')]));
    gateway.listeners[0]!();
    await settle();
    expect(useConversationActivitySeenStore().seenRunIds).toEqual({});
  });
});
