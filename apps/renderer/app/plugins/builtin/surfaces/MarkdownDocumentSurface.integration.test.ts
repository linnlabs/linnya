// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ acceptAll: vi.fn(), rejectAll: vi.fn() }));

vi.mock('@/app/pages/MarkdownEditorPage/MarkdownEditorPage.vue', async () => {
  const { defineComponent, h } = await import('vue');
  const { default: RevisionGlobalToolbar } = await import(
    '@/domains/editor/features/Revision/ui/RevisionGlobalToolbar.vue'
  );
  return {
    default: defineComponent({
      setup: () => () => h('div', { class: 'test-document-content' }, [
        h(RevisionGlobalToolbar, {
          visible: true,
          pendingCount: 1,
          insertCount: 2,
          deleteCount: 1,
          onAcceptAll: actions.acceptAll,
          onRejectAll: actions.rejectAll,
        }),
      ]),
    }),
  };
});

import MarkdownDocumentSurface from './MarkdownDocumentSurface.vue';

describe('Markdown Document Surface 修订操作栏', () => {
  let app: App | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('分别挂到所属文档的非滚动视口，保留动作并随宿主卸载', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(defineComponent({
      render: () => h('div', [h(MarkdownDocumentSurface), h(MarkdownDocumentSurface)]),
    }));
    app.use(createPinia());
    app.mount(host);
    await nextTick();

    const viewports = host.querySelectorAll('.document-surface__editor-viewport');
    expect(viewports).toHaveLength(2);
    for (const viewport of viewports) {
      const toolbar = viewport.querySelector('.revision-global-toolbar');
      expect(toolbar?.parentElement).toBe(viewport);
      expect(viewport.querySelector('.editor-shell .revision-global-toolbar')).toBeNull();
      toolbar?.querySelector<HTMLButtonElement>('.reject-btn')?.click();
      toolbar?.querySelector<HTMLButtonElement>('.accept-btn')?.click();
    }
    expect(actions.acceptAll).toHaveBeenCalledTimes(2);
    expect(actions.rejectAll).toHaveBeenCalledTimes(2);

    app.unmount();
    app = null;
    expect(document.querySelector('.revision-global-toolbar')).toBeNull();
  });
});
