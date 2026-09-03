// @vitest-environment jsdom

import { createApp, h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MindMapSubrunParallelCard from './MindMapSubrunParallelCard.vue';

vi.mock('@plugin/renderer/subrunToolUi', () => ({
  SubrunCard: {
    props: ['subrunId', 'lazySubrunTraceSource'],
    template: `
      <div
        class="subrun-card-stub"
        :data-subrun-id="subrunId"
        :data-parent-tool-call-id="lazySubrunTraceSource?.parentToolCallId"
      />
    `,
  },
}));

describe('MindMapSubrunParallelCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('forwards the historical lazy trace source to every parallel SubrunCard', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const lazySource = {
      conversationId: 'conv-1',
      parentToolCallId: 'parent-call',
      kinds: ['tool_process', 'tool_output'] as const,
    };
    const app = createApp({
      render: () => h(MindMapSubrunParallelCard, {
        messageId: 'message-parent',
        presentation: {
          uiKey: 'mindmap_subrun_parallel',
          status: 'loading',
          phase: 'start',
          data: {
            kind: 'parallel-subruns',
            items: [
              {
                subrunId: 'parent-call_0',
                presentation: {
                  uiKey: 'mindmap_subrun_parallel',
                  status: 'loading',
                  phase: 'start',
                  data: { description: '任务一', status: 'loading', subagentType: 'mindmap' },
                },
              },
              {
                subrunId: 'parent-call_1',
                presentation: {
                  uiKey: 'mindmap_subrun_parallel',
                  status: 'loading',
                  phase: 'start',
                  data: { description: '任务二', status: 'loading', subagentType: 'mindmap' },
                },
              },
            ],
          },
        },
        lazySubrunTraceSource: lazySource,
      }),
    });

    app.mount(container);
    await nextTick();

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.subrun-card-stub'));
    expect(cards.map(card => card.dataset.subrunId)).toEqual(['parent-call_0', 'parent-call_1']);
    expect(cards.every(card => card.dataset.parentToolCallId === 'parent-call')).toBe(true);
    app.unmount();
  });
});
