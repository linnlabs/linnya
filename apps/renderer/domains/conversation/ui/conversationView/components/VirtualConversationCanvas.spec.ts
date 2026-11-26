// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  conversationVisualTurnIdFromUserMessageId,
} from '@app/schemas';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type { TanstackConversationVisibleItem } from '../composables/useTanstackConversationVirtualizer';
import type {
  ConversationMessageCanvasTrailingStatus,
  ConversationMessageVisualRow,
} from '../../messageCanvas';
import VirtualConversationCanvas from './VirtualConversationCanvas.vue';

vi.mock('../../Message.vue', () => ({
  default: defineComponent({
    props: ['message'],
    emits: ['edit-message'],
    setup: (props, { emit }) => () => h('button', {
      'data-renderer': props.message.id,
      onClick: () => emit('edit-message', props.message),
    }),
  }),
}));

vi.mock('../../messageCanvas/components/ConversationVisualRowActions.vue', () => ({
  default: defineComponent({ setup: () => () => h('div') }),
}));

function createMessage(id: string, type: BaseMessage['type'] = 'final_answer'): BaseMessage {
  return type === 'user_input'
    ? createTestUserMessage({ id, content: id, timestamp: 0 })
    : createTestAnswerMessage({ id, content: id, timestamp: 0 });
}

function createRow(id: string, index: number): ConversationMessageVisualRow {
  const payload = createMessage(id, index === 0 ? 'user_input' : 'final_answer');
  return {
    key: `msg_${id}`,
    kind: 'message',
    estimatedHeight: 100,
    visualTurnId: conversationVisualTurnIdFromUserMessageId('user-1'),
    turnContext: {
      id: conversationVisualTurnIdFromUserMessageId('user-1'),
      userMessageId: 'user-1',
      sourceMessageIds: ['user-1', 'answer-1'],
    },
    isTurnStart: index === 0,
    isTurnEnd: index === 1,
    role: payload.role,
    bounded: false,
    payload,
  };
}

function createVirtualRows(items: ConversationMessageVisualRow[]): TanstackConversationVisibleItem[] {
  return items.map((item, index) => ({
    item,
    index,
    virtualItem: {
      key: item.key,
      index,
      start: 20 + index * 120,
      end: 120 + index * 120,
      size: 100,
      lane: 0,
    },
  }));
}

describe('VirtualConversationCanvas', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
  });

  it('mounts message rows on the TanStack canvas and forwards leaf events', async () => {
    const items = [createRow('user-1', 0), createRow('answer-1', 1)];
    const rows = createVirtualRows(items);
    rows[1] = {
      ...rows[1],
      virtualItem: { ...rows[1].virtualItem, start: 900, end: 1000 },
    };
    const measuredElements: HTMLElement[] = [];
    const measureElement = vi.fn((element: Element | object | null) => {
      if (element instanceof HTMLElement) measuredElements.push(element);
    });
    const layoutChange = vi.fn();
    const editMessage = vi.fn();

    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp({
      render: () => h(VirtualConversationCanvas, {
        items,
        messages: items.map(item => item.payload),
        virtualRows: rows,
        totalHeight: 1_200,
        scrollMargin: 20,
        timelinePositions: [{
          visualTurnId: conversationVisualTurnIdFromUserMessageId('user-1'),
          top: 20,
          height: 100,
          measured: false,
        }],
        measureElement,
        onLayoutChange: layoutChange,
        onEditMessage: editMessage,
      }),
    });
    app.mount(mountPoint);
    await nextTick();

    const mountedRows = Array.from(
      mountPoint.querySelectorAll<HTMLElement>('.virtual-conversation-canvas-item'),
    );
    expect(mountedRows.map(row => row.style.transform)).toEqual([
      'translateY(0px)',
      'translateY(880px)',
    ]);
    expect(measuredElements).toEqual(mountedRows);
    expect(layoutChange).toHaveBeenCalledWith([
      { visualTurnId: 'visual_turn_user-1', top: 20, height: 100, measured: false },
    ]);

    mountPoint.querySelector<HTMLButtonElement>('[data-renderer="answer-1"]')?.click();
    expect(editMessage).toHaveBeenCalledWith(createMessage('answer-1'));
  });

  it('运行状态行只接入最后一行的共享 tail region，文字变化不增删占位，运行结束后释放', async () => {
    const items = [createRow('user-1', 0), { ...createRow('answer-1', 1), isTurnEnd: true }];
    const rows = createVirtualRows(items);
    const status = ref<ConversationMessageCanvasTrailingStatus | null>({
      text: '正在查找',
      elapsedText: '35秒',
      motion: 'processing',
    });
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);

    app = createApp({
      render: () => h(VirtualConversationCanvas, {
        items,
        messages: items.map(item => item.payload),
        virtualRows: rows,
        totalHeight: 240,
        scrollMargin: 20,
        timelinePositions: [],
        measureElement: () => undefined,
        trailingStatus: status.value,
      }),
    });
    app.mount(mountPoint);
    await nextTick();

    const statusRows = mountPoint.querySelectorAll('[data-run-status-row]');
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]?.closest('[data-index]')?.getAttribute('data-index')).toBe('1');
    expect(statusRows[0]?.textContent?.replace(/\s+/g, '')).toBe('正在查找·35秒');
    const tailRegion = mountPoint.querySelector('.conversation-visual-row__tail');

    status.value = { text: '等你批准命令', elapsedText: '1分钟28秒', motion: 'still' };
    await nextTick();
    expect(mountPoint.querySelector('.conversation-visual-row__tail')).toBe(tailRegion);
    expect(mountPoint.querySelector('[data-run-status-row]')?.classList.contains('is-still')).toBe(true);

    status.value = null;
    await nextTick();
    expect(mountPoint.querySelector('[data-run-status-row]')).toBeNull();
  });

  it('run 终态后仍由有效回答的 tail region 提供 hover actions 区域', async () => {
    const items = [createRow('user-1', 0), createRow('answer-1', 1)];
    const rows = createVirtualRows(items);
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);

    app = createApp({
      render: () => h(VirtualConversationCanvas, {
        items,
        messages: items.map(item => item.payload),
        virtualRows: rows,
        totalHeight: 240,
        scrollMargin: 20,
        timelinePositions: [],
        measureElement: () => undefined,
        trailingStatus: null,
      }),
    });
    app.mount(mountPoint);
    await nextTick();

    const tailRegions = mountPoint.querySelectorAll('.conversation-visual-row__tail');
    expect(tailRegions).toHaveLength(1);
    expect(tailRegions[0]?.closest('[data-index]')?.getAttribute('data-index')).toBe('1');
    expect(tailRegions[0]?.querySelector('[data-run-status-row]')).toBeNull();
  });
});
