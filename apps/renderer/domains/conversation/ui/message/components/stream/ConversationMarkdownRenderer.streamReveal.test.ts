// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConversationMarkdownRenderer from './ConversationMarkdownRenderer';

const { markdownNodeStub } = vi.hoisted(() => ({
  markdownNodeStub: { name: 'MarkdownNodeStub', render: () => null },
}));

vi.mock('../markstream/ConversationCodeBlockNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../markstream/ConversationReferenceNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../citation/ConversationCitationNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('./ConversationMathInlineNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('./ConversationMathBlockNode.vue', () => ({ default: markdownNodeStub }));
vi.mock('../../../../features/resource-link/ui/ConversationResourceLinkNode.vue', () => ({
  default: markdownNodeStub,
}));

describe('ConversationMarkdownRenderer streamReveal', () => {
  let app: App<Element> | null = null;
  let mountPoint: HTMLElement | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    mountPoint?.remove();
    mountPoint = null;
    vi.useRealTimers();
  });

  function mountRenderer(options: { content: string; streamReveal: boolean; isStreaming?: boolean }) {
    vi.useFakeTimers();
    const content = ref(options.content);
    const isStreaming = ref(options.isStreaming ?? true);
    const Host = defineComponent({
      setup: () => () => h(ConversationMarkdownRenderer, {
        content: content.value,
        isStreaming: isStreaming.value,
        streamReveal: options.streamReveal,
      }),
    });
    mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(Host);
    app.mount(mountPoint);
    return { content, isStreaming };
  }

  /** 让匀速放字走完（落后上限 250ms）并让节流解析提交。 */
  async function settleParse(): Promise<void> {
    await nextTick();
    vi.advanceTimersByTime(400);
    await nextTick();
    vi.advanceTimersByTime(60);
    await nextTick();
    await nextTick();
  }

  const freshTexts = () =>
    [...(mountPoint?.querySelectorAll('.conversation-stream-text__fresh') ?? [])].map(node => node.textContent);

  it('挂载时已有的内容直接显示，不淡入', async () => {
    mountRenderer({ content: 'existing text', streamReveal: true });
    await settleParse();
    expect(mountPoint?.textContent).toBe('existing text');
    expect(freshTexts()).toEqual([]);
  });

  it('尾部追加的文字作为淡入段出现，整段文本保持连续', async () => {
    const fixture = mountRenderer({ content: 'existing', streamReveal: true });
    await settleParse();

    fixture.content.value = 'existing grows';
    await settleParse();

    expect(freshTexts()).toEqual([' grows']);
    expect(mountPoint?.textContent).toBe('existing grows');
  });

  it('动画结束后淡入段并回普通文字，文本不变', async () => {
    const fixture = mountRenderer({ content: 'existing', streamReveal: true });
    await settleParse();
    fixture.content.value = 'existing grows';
    await settleParse();

    mountPoint?.querySelector('.conversation-stream-text__fresh')?.dispatchEvent(new Event('animationend', { bubbles: true }));
    await nextTick();

    expect(freshTexts()).toEqual([]);
    expect(mountPoint?.textContent).toBe('existing grows');
  });

  it('流式中新长出的块整段淡入', async () => {
    const fixture = mountRenderer({ content: 'first', streamReveal: true });
    await settleParse();
    fixture.content.value = 'first\n\nsecond block';
    await settleParse();

    expect(freshTexts()).toEqual(['second block']);
    expect(mountPoint?.querySelectorAll('p')[0]?.textContent).toBe('first');
  });

  it('挂载时正文为空：第一批文字就淡入', async () => {
    const fixture = mountRenderer({ content: '', streamReveal: true });
    await settleParse();
    fixture.content.value = 'hello';
    await settleParse();
    expect(freshTexts()).toEqual(['hello']);
  });

  it('关闭 streamReveal 时不产生任何额外节点', async () => {
    const fixture = mountRenderer({ content: 'existing', streamReveal: false });
    await settleParse();
    fixture.content.value = 'existing grows';
    await settleParse();
    expect(mountPoint?.querySelectorAll('span').length).toBe(0);
    expect(mountPoint?.textContent).toBe('existing grows');
  });

  it('封口后恢复普通文字，段落元素保持同一个，正文只提交一次', async () => {
    const fixture = mountRenderer({ content: 'existing', streamReveal: true });
    await settleParse();
    fixture.content.value = 'existing grows';
    await settleParse();
    const paragraph = mountPoint?.querySelector('p');

    fixture.isStreaming.value = false;
    await nextTick();
    await nextTick();

    expect(mountPoint?.querySelector('p')).toBe(paragraph);
    expect(freshTexts()).toEqual([]);
    expect(mountPoint?.textContent).toBe('existing grows');
  });

  it('不是尾部追加的变化（改写）直接显示，不淡入', async () => {
    const fixture = mountRenderer({ content: 'old words', streamReveal: true });
    await settleParse();
    fixture.content.value = 'completely new';
    await settleParse();
    expect(freshTexts()).toEqual([]);
    expect(mountPoint?.textContent).toBe('completely new');
  });

  describe('匀速吐字', () => {
    const long = 'x'.repeat(120);

    it('追加的长文本不会一次性出现，随时间放出直到完整', async () => {
      const fixture = mountRenderer({ content: 'start', streamReveal: true });
      await settleParse();

      fixture.content.value = `start ${long}`;
      await nextTick();
      vi.advanceTimersByTime(64);
      await nextTick();
      vi.advanceTimersByTime(60);
      await nextTick();
      const partial = mountPoint?.textContent ?? '';
      expect(partial.length).toBeGreaterThan('start'.length);
      expect(partial.length).toBeLessThan(`start ${long}`.length);

      await settleParse();
      expect(mountPoint?.textContent).toBe(`start ${long}`);
    });

    it('流式结束时立刻补齐完整正文', async () => {
      const fixture = mountRenderer({ content: 'start', streamReveal: true });
      await settleParse();
      fixture.content.value = `start ${long}`;
      await nextTick();
      vi.advanceTimersByTime(32);
      await nextTick();

      fixture.isStreaming.value = false;
      await nextTick();
      await nextTick();
      expect(mountPoint?.textContent).toBe(`start ${long}`);
      expect(freshTexts()).toEqual([]);
    });

    it('关闭 streamReveal 时追加内容立即提交（不依赖逐帧调度）', async () => {
      const fixture = mountRenderer({ content: 'start', streamReveal: false });
      await settleParse();
      fixture.content.value = `start ${long}`;
      await nextTick();
      vi.advanceTimersByTime(60);
      await nextTick();
      expect(mountPoint?.textContent).toBe(`start ${long}`);
    });
  });
});
