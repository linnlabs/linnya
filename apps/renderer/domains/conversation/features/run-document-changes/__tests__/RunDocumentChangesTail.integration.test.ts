// @vitest-environment jsdom

import { createPinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type { ConversationVisualRow } from '../../../ui/messageCanvas';
import ConversationMessageCanvas from '../../../ui/messageCanvas/components/ConversationMessageCanvas.vue';
import type { RunDocumentChangeItem, RunDocumentChangesPort } from '../definitions/runDocumentChanges';
import { registerRunDocumentChangesPort } from '../registry/runDocumentChangesPort';
import { clearRunDocumentChangesCache } from '../store/runDocumentChangesCache';

vi.mock('../../../ui/Message.vue', () => ({
  default: defineComponent({ props: ['message'], setup: props => () => h('p', props.message.id) }),
}));
vi.mock('../../../ui/messageCanvas/components/ConversationVisualRowActions.vue', () => ({
  default: defineComponent({ setup: () => () => h('div', { class: 'conversation-answer-actions--turn' }) }),
}));

const Icon = defineComponent({ setup: () => () => h('svg') });

function item(documentId: string, extra: Partial<RunDocumentChangeItem>): RunDocumentChangeItem {
  return {
    documentId, projectId: 'p', parentId: null, title: documentId, iconComponent: Icon, iconClass: '',
    activeDocumentType: 'document', deleted: false, created: false, bySubrunOnly: false,
    status: { kind: 'none' }, action: null, ...extra,
  };
}

const report = item('市场调研报告', { status: { kind: 'pending', count: 4 }, action: 'review' });
const deck = item('竞品对比', { activeDocumentType: 'slides', bySubrunOnly: true, status: { kind: 'applied' }, action: 'history' });

function turn(durationMs: number): { rows: ConversationVisualRow[]; messages: BaseMessage[] } {
  const user = createTestUserMessage({
    id: 'user-1', content: '改文档', timestamp: 0,
    metadata: { run_id: 'run-1', agent_work: { duration_ms: durationMs, ended_at: 1, outcome: 'completed' } },
  });
  const answer = createTestAnswerMessage({ id: 'answer-1', content: '好了', timestamp: 1, metadata: { run_id: 'run-1' } });
  const visualTurnId = conversationVisualTurnIdFromUserMessageId('user-1');
  const rows = [user, answer].map((payload, index): ConversationVisualRow => ({
    key: `msg_${payload.id}`,
    kind: 'message',
    estimatedHeight: 100,
    visualTurnId,
    turnContext: { id: visualTurnId, userMessageId: 'user-1', sourceMessageIds: ['user-1', 'answer-1'] },
    isTurnStart: index === 0,
    isTurnEnd: index === 1,
    role: payload.role,
    bounded: false,
    payload,
  }));
  return { rows, messages: [user, answer] };
}

const apps: App[] = [];

async function mountTail(options: { durationMs: number; shows?: boolean }): Promise<HTMLElement> {
  const { rows, messages } = turn(options.durationMs);
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(defineComponent({
    render: () => h(ConversationMessageCanvas, {
      items: rows, messages, showsRunDocumentChanges: options.shows ?? true,
    }),
  }));
  app.use(createPinia());
  app.provide(CONVERSATION_RENDER_SCOPE_KEY, Object.freeze({ conversationId: 'conv-1' }));
  app.mount(host);
  apps.push(app);
  await settle();
  return host;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  await nextTick();
}

let port: { list: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; watch: ReturnType<typeof vi.fn> };

beforeEach(() => {
  clearRunDocumentChangesCache();
  port = {
    list: vi.fn(async () => ({ items: [report, deck], truncated: false })),
    open: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  };
  registerRunDocumentChangesPort(port as unknown as RunDocumentChangesPort);
});

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
});

describe('一轮回复末尾的改动清单', () => {
  it('按本轮运行查询；收起时一行写总数和待审阅数，已工作时长移到最下面', async () => {
    const host = await mountTail({ durationMs: 18 * 60_000 + 40_000 });
    expect(port.list).toHaveBeenCalledWith({ conversationId: 'conv-1', rootRunIds: ['run-1'] });

    const tail = host.querySelector('.conversation-visual-row__tail');
    const note = tail?.querySelector('.conversation-visual-row__tail-line > .run-document-changes-note');
    expect(note?.textContent?.replace(/\s+/g, ' ').trim()).toBe('改了 2 份文档·1 份待审阅');
    expect(tail?.querySelector('.conversation-visual-row__tail-line > .turn-work-duration-hint')).toBeNull();
    const duration = tail?.lastElementChild;
    expect(duration?.classList.contains('turn-work-duration-hint')).toBe(true);
    expect(duration?.textContent).toContain('18m 40s');
    expect(tail?.querySelector('.run-document-changes-list')).toBeNull();
    expect(port.watch).toHaveBeenCalledWith(new Set([report.documentId, deck.documentId]), expect.any(Function));
  });

  it('展开后待审阅排前、各自去自己的审阅或历史；时长仍在清单下面', async () => {
    const host = await mountTail({ durationMs: 6 * 60_000 });
    (host.querySelector('.run-document-changes-note') as HTMLButtonElement).click();
    await nextTick();

    const list = host.querySelector('.run-document-changes-list');
    const rows = [...(list?.querySelectorAll('.run-document-changes-row') ?? [])];
    expect(rows.map(row => row.querySelector('.run-document-changes-row__name')?.textContent?.trim())).toEqual(['市场调研报告', '竞品对比']);
    expect(rows[0]?.textContent).toContain('4 处待审阅');
    expect(rows[1]?.textContent).toContain('子任务修改');
    expect(rows[1]?.textContent).toContain('已生效');
    expect(list?.nextElementSibling?.classList.contains('turn-work-duration-hint')).toBe(true);

    (rows[1]?.querySelector('.run-document-changes-row__action') as HTMLButtonElement).click();
    (rows[0] as HTMLElement).click();
    await settle();
    expect(port.open.mock.calls).toEqual([[deck, 'history'], [report, 'review']]);
  });

  it('不到 5 分钟不显示时长；Subrun 详情等未开启的画布不查询', async () => {
    const host = await mountTail({ durationMs: 60_000 });
    expect(host.querySelector('.turn-work-duration-hint')).toBeNull();
    expect(host.querySelector('.run-document-changes-note')).not.toBeNull();

    port.list.mockClear();
    const other = await mountTail({ durationMs: 60_000, shows: false });
    expect(port.list).not.toHaveBeenCalled();
    expect(other.querySelector('.run-document-changes-note')).toBeNull();
  });

  it('只改了一份时不折叠，点它直接去审阅', async () => {
    port.list.mockResolvedValue({ items: [report], truncated: false });
    const host = await mountTail({ durationMs: 0 });
    const note = host.querySelector('.run-document-changes-note') as HTMLButtonElement;
    expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe('改了《市场调研报告》·4 处待审阅');
    expect(note.querySelector('.run-document-changes-note__chevron')).toBeNull();
    note.click();
    await settle();
    expect(port.open).toHaveBeenCalledWith(report, 'review');
  });
});
