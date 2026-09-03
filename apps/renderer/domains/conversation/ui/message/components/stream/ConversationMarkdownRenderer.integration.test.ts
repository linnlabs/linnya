// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  provide,
  ref,
  type App,
} from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONVERSATION_RENDER_SCHEDULING_PORT_KEY } from '../../../../definitions/conversationRenderScheduling';
import ConversationMarkdownRenderer from './ConversationMarkdownRenderer';

const { markdownNodeStub } = vi.hoisted(() => ({
  markdownNodeStub: {
    name: 'MarkdownNodeStub',
    render: () => null,
  },
}));

vi.mock('../markstream/ConversationCodeBlockNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../markstream/ConversationReferenceNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../citation/ConversationCitationNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('./ConversationMathInlineNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('./ConversationMathBlockNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../../../../features/resource-link/ui/ConversationResourceLinkNode.vue', () => ({
  default: markdownNodeStub,
}));

describe('ConversationMarkdownRenderer streaming scheduling', () => {
  let app: App<Element> | null = null;
  let mountPoint: HTMLElement | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    mountPoint?.remove();
    mountPoint = null;
    vi.useRealTimers();
  });

  function mountStreamingRenderer(initialContent: string) {
    vi.useFakeTimers();
    const content = ref(initialContent);
    const isContentWidthChanging = ref(false);
    const Host = defineComponent({
      setup() {
        provide(CONVERSATION_RENDER_SCHEDULING_PORT_KEY, {
          isContentWidthChanging: () => isContentWidthChanging.value,
        });
        return () => h(ConversationMarkdownRenderer, {
          content: content.value,
          isStreaming: true,
        });
      },
    });

    mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(Host);
    app.mount(mountPoint);

    return { content, isContentWidthChanging };
  }

  async function flushStreamingParse(): Promise<void> {
    vi.advanceTimersByTime(50);
    await nextTick();
  }

  it('keeps the rendered body stable during width motion and catches up once afterward', async () => {
    const fixture = mountStreamingRenderer('first paragraph');
    await flushStreamingParse();
    expect(mountPoint?.textContent).toContain('first paragraph');

    fixture.isContentWidthChanging.value = true;
    fixture.content.value = 'first paragraph\n\nsecond paragraph';
    await nextTick();
    vi.advanceTimersByTime(300);
    await nextTick();

    expect(mountPoint?.textContent).not.toContain('second paragraph');

    fixture.isContentWidthChanging.value = false;
    await nextTick();

    expect(mountPoint?.textContent).toContain('second paragraph');
  });

  it('preserves completed block DOM while only the streaming tail changes', async () => {
    const fixture = mountStreamingRenderer('stable paragraph\n\ntail');
    await flushStreamingParse();
    const stableParagraph = mountPoint?.querySelectorAll('p')[0];
    expect(stableParagraph?.textContent).toBe('stable paragraph');

    fixture.content.value = 'stable paragraph\n\ntail grows';
    await nextTick();
    await flushStreamingParse();

    expect(mountPoint?.querySelectorAll('p')[0]).toBe(stableParagraph);
    expect(mountPoint?.textContent).toContain('tail grows');
  });
});
