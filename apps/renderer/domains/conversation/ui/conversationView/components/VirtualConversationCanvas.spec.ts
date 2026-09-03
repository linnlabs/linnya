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
import type { ConversationVisualRow } from '../../messageCanvas';
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

vi.mock('../../components/ConversationWorkDurationHint.vue', () => ({
  default: defineComponent({ setup: () => () => h('div') }),
}));

function createMessage(id: string, type: BaseMessage['type'] = 'final_answer'): BaseMessage {
  return type === 'user_input'
    ? createTestUserMessage({ id, content: id, timestamp: 0 })
    : createTestAnswerMessage({ id, content: id, timestamp: 0 });
}

function createRow(id: string, index: number): ConversationVisualRow {
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

function createVirtualRows(items: ConversationVisualRow[]): TanstackConversationVisibleItem[] {
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

  it('把等待图标接入最后一行的共享 tail region，显隐不增删占位', async () => {
    const items = [{ ...createRow('user-1', 0), isTurnEnd: true }];
    const rows = createVirtualRows(items);
    const trailingStatusActive = ref(true);
    const trailingStatusVisible = ref(false);
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);

    app = createApp({
      render: () => h(VirtualConversationCanvas, {
        items,
        messages: items.map(item => item.payload),
        virtualRows: rows,
        totalHeight: 120,
        scrollMargin: 20,
        timelinePositions: [],
        measureElement: () => undefined,
        trailingStatus: {
          active: trailingStatusActive.value,
          visible: trailingStatusVisible.value,
        },
      }),
    });
    app.mount(mountPoint);
    await nextTick();

    const tailRegion = mountPoint.querySelector('.conversation-visual-row__tail');
    const indicator = mountPoint.querySelector('.conversation-visual-row__waiting-indicator');
    expect(tailRegion).not.toBeNull();
    expect(indicator?.classList.contains('is-visible')).toBe(false);
    expect(mountPoint.querySelector('.waiting-indicator')).toBeNull();

    trailingStatusVisible.value = true;
    await nextTick();
    expect(mountPoint.querySelector('.conversation-visual-row__tail')).toBe(tailRegion);
    expect(indicator?.classList.contains('is-visible')).toBe(true);

    trailingStatusActive.value = false;
    await nextTick();
    expect(mountPoint.querySelector('.conversation-visual-row__tail')).toBeNull();
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
        trailingStatus: { active: false, visible: false },
      }),
    });
    app.mount(mountPoint);
    await nextTick();

    const tailRegions = mountPoint.querySelectorAll('.conversation-visual-row__tail');
    expect(tailRegions).toHaveLength(1);
    expect(tailRegions[0]?.closest('[data-index]')?.getAttribute('data-index')).toBe('1');
    expect(tailRegions[0]?.querySelector('.conversation-visual-row__waiting-indicator')).toBeNull();
  });
});
