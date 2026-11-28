// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { expect, it, vi } from 'vitest';
import { DOCUMENT_PREVIEW_LAYOUT } from '@linnya/document-preview';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { DOCUMENT_PREVIEW_MESSAGE_CATALOG } from '../definitions/documentPreviewMessageCatalog';
import type { RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
import { useNavigationScope } from '@/app/navigation';
import ReadonlyDocumentPreview from '../ui/ReadonlyDocumentPreview.vue';
const ports = vi.hoisted(() => ({
  read: vi.fn(),
  preview: vi.fn(),
  availability: vi.fn(),
  stopMutation: vi.fn(),
  stopAvailability: vi.fn(),
  recovery: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: ports.read }));
vi.mock('@plugin/renderer/documentPreview', () => ({ readDocumentPreview: ports.preview }));
vi.mock('@plugin/renderer/pluginRuntime', () => ({
  subscribeRendererPluginAvailability: ports.availability,
}));
vi.mock('@/shared/ipc/workspaceMutationSubscription', () => ({
  subscribeToWorkspaceMutation: () => ports.stopMutation,
}));
vi.mock('@/app/plugins/documentTypePresentation', () => ({
  readDocumentTypePreviewComponent: () => null,
  readDocumentTypeIcon: () => null,
  readDocumentTypeRecoveryAction: ports.recovery,
}));
vi.mock('@plugin/renderer/workspaceNavigation', () => ({
  getWorkspaceNavigationPort: () => ({ openDocumentByNodeType: ports.open }),
}));
it('detailOnly renders readonly Markdown immediately, blocks nested navigation and removes content on availability or project changes', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  await import('@linnya/markdown-document-core');
  ports.read.mockResolvedValue({
    documentId: 'doc',
    status: 'available',
    title: 'Doc',
    nodeType: 'document',
    path: 'workspace:/Doc.md',
  });
  ports.preview.mockResolvedValue({
    documentId: 'doc',
    title: 'Doc',
    nodeType: 'document',
    status: 'ready',
    content: {
      revisionKey: '1',
      summary: 'Cover summary',
      detail: { format: 'markdown', text: '# Full detail\n\n[Target](workspace:/Target.md)' },
    },
  });
  let availabilityChanged:
    | ((changes: readonly RendererPluginAvailabilityChange[]) => void)
    | undefined;
  ports.availability.mockImplementation(
    (listener: (changes: readonly RendererPluginAvailabilityChange[]) => void) => {
      availabilityChanged = listener;
      return ports.stopAvailability;
    }
  );
  const host = document.createElement('div'),
    pinia = createPinia();
  document.body.append(host);
  setActivePinia(pinia);
  const scope = useNavigationScope();
  scope.enterProject('project');
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        detailOnly: true,
        widthPx: 320,
      }),
  }).use(pinia);
  const began = performance.now(),
    transitions: { elapsed: number; html: string }[] = [];
  const observer = new MutationObserver(() =>
    transitions.push({ elapsed: performance.now() - began, html: host.innerHTML })
  );
  observer.observe(host, { childList: true, subtree: true, characterData: true });
  try {
    app.mount(host);
    await vi.waitFor(() =>
      expect(
        host.querySelector('h1')?.textContent,
        JSON.stringify({
          elapsed: performance.now() - began,
          reads: ports.read.mock.calls.length,
          previews: ports.preview.mock.calls.length,
          transitions,
        })
      ).toBe('Full detail')
    );
    expect(host.textContent).not.toContain('Cover summary');
    expect(host.querySelectorAll('[contenteditable]')).toHaveLength(0);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    ports.read.mockResolvedValue({
      documentId: 'doc',
      status: 'plugin_unavailable',
      title: 'Doc',
      nodeType: 'document',
      path: 'workspace:/Doc.md',
    });
    ports.preview.mockResolvedValue({
      documentId: 'doc',
      title: 'Doc',
      nodeType: 'document',
      status: 'plugin_unavailable',
      content: { revisionKey: '1', summary: 'Snapshot' },
    });
    availabilityChanged?.([
      { pluginId: 'example', state: 'disabled', documentNodeTypes: ['document'] },
    ]);
    await vi.waitFor(() => expect(host.textContent).toContain('Snapshot'));
    expect(host.querySelector('h1')).toBeNull();
    scope.enterProject('other');
    await vi.waitFor(() => expect(host.textContent).toContain('不在当前项目'));
    expect(host.querySelector('h1')).toBeNull();
  } finally {
    observer.disconnect();
    app.unmount();
    host.remove();
  }
  expect(ports.stopMutation).toHaveBeenCalledOnce();
  expect(ports.stopAvailability).toHaveBeenCalledOnce();
});

/** 两个根块的正式正文：jsdom 没有布局，靠测量桩决定它算“一屏放得下”还是“被首屏截断”。 */
async function mountTwoBlockPreview(initialWidth: number) {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const { ref } = await import('vue');
  const { WorkspaceMarkdownPreviewSchema } = await import('@app/schemas');
  await import('@linnya/markdown-document-core/workspace-preview');
  const content = WorkspaceMarkdownPreviewSchema.parse({
    format: 'workspace-markdown',
    assets: {},
    references: {},
    document: {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root' },
          content: [
            {
              type: 'baseBlock',
              attrs: { id: 'body' },
              content: [{ type: 'text', text: '正式正文：按卡宽换行，首屏不显示原始代码。' }],
            },
          ],
        },
        {
          type: 'rootBlock',
          attrs: { id: 'root-2' },
          content: [
            {
              type: 'baseBlock',
              attrs: { id: 'below' },
              content: [{ type: 'text', text: '屏下正文：全文里才有。' }],
            },
          ],
        },
      ],
    },
  });
  ports.read.mockResolvedValue({
    documentId: 'doc',
    status: 'available',
    title: '同一文档',
    nodeType: 'document',
    path: 'workspace:/Doc.md',
  });
  ports.preview.mockResolvedValue({
    documentId: 'doc',
    title: '同一文档',
    nodeType: 'document',
    status: 'ready',
    content: { revisionKey: '1', summary: 'Agent 摘要不能冒充正文', detail: content },
  });
  ports.availability.mockReturnValue(ports.stopAvailability);
  const pinia = createPinia();
  setActivePinia(pinia);
  useNavigationScope().enterProject('project');
  const width = ref(initialWidth),
    host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        widthPx: width.value,
      }),
  }).use(pinia);
  app.mount(host);
  return {
    host,
    width,
    unmount() {
      app.unmount();
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}
const FIRST_SCREEN_HEIGHT = `${DOCUMENT_PREVIEW_LAYOUT.firstScreenHeight}px`;

it('一屏放得下的文档按内容高度显示全文，移入不重排，换宽度按新宽度换行', async () => {
  const sample = await mountTwoBlockPreview(280);
  const { host } = sample;
  try {
    await vi.waitFor(() => expect(host.textContent).toContain('正式正文'));
    expect(host.textContent).not.toContain('Agent 摘要');
    expect(host.querySelector('.workspace-markdown-preview')?.getAttribute('style')).toContain(
      '244px'
    );
    // 首屏只限最大高度，短文不留空白；全文已在眼前。
    const firstScreen = host.querySelector<HTMLElement>('.document-preview-first-screen');
    expect(firstScreen?.style.maxHeight).toBe(FIRST_SCREEN_HEIGHT);
    expect(firstScreen?.style.height).toBe('');
    expect(host.textContent).toContain('屏下正文');
    const root = host.querySelector('.readonly-document-preview');
    root?.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    expect(host.querySelector('.document-preview-first-screen')).toBe(firstScreen);
    sample.width.value = 420;
    await vi.waitFor(() =>
      expect(host.querySelector('.workspace-markdown-preview')?.getAttribute('style')).toContain(
        '384px'
      )
    );
    expect(ports.preview).toHaveBeenCalledOnce();
    expect(host.querySelector('[contenteditable]')).toBeNull();
  } finally {
    sample.unmount();
  }
  expect(ports.stopMutation).toHaveBeenCalledOnce();
});

it.each([
  ['指针移入', new MouseEvent('mouseenter')],
  ['键盘焦点进入', new FocusEvent('focusin', { bubbles: true })],
])('被首屏截断的文档在%s时原地换成全文，滚动区高度上限不变，没有展开按钮', async (_name, engage) => {
  // 固定高度代表“超过首屏”。
  const measure = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 420, 400));
  const sample = await mountTwoBlockPreview(420);
  const { host } = sample;
  try {
    await vi.waitFor(() => expect(host.querySelector('.document-preview-clipped')).not.toBeNull());
    const viewport = host.querySelector<HTMLElement>('.readonly-document-preview__viewport');
    expect(viewport?.style.maxHeight).toBe(FIRST_SCREEN_HEIGHT);
    expect(host.textContent).toContain('正式正文');
    expect(host.textContent).not.toContain('屏下正文');
    expect(host.querySelector('.readonly-document-preview > button')).toBeNull();
    const root = host.querySelector('.readonly-document-preview');
    (engage.type === 'focusin' ? viewport : root)?.dispatchEvent(engage);
    await vi.waitFor(() => expect(host.querySelector('.document-preview-first-screen')).toBeNull());
    expect(host.textContent).toContain('正式正文');
    expect(host.textContent).toContain('屏下正文');
    expect(host.querySelector('.readonly-document-preview__viewport')).toBe(viewport);
    expect(viewport?.style.maxHeight).toBe(FIRST_SCREEN_HEIGHT);
    expect(host.querySelector('.readonly-document-preview > button')).toBeNull();
    expect(ports.preview).toHaveBeenCalledOnce();
  } finally {
    measure.mockRestore();
    sample.unmount();
  }
});

it('plugin recovery is explicit and shared preview opening rechecks the current document scope', async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const identity = {
    documentId: 'doc',
    status: 'plugin_unavailable',
    title: '文档',
    nodeType: 'example',
    path: 'workspace:/Doc',
  };
  ports.read.mockResolvedValue(identity);
  ports.preview.mockResolvedValue({
    ...identity,
    content: { revisionKey: '1', summary: '已保存的快照' },
  });
  ports.availability.mockReturnValue(ports.stopAvailability);
  const activate = vi.fn(async () => {
    ports.read.mockResolvedValue({ ...identity, status: 'available' });
    ports.preview.mockResolvedValue({
      ...identity,
      status: 'ready',
      content: { revisionKey: '2', summary: '', detail: { format: 'text', text: '最新正文' } },
    });
  });
  ports.recovery.mockReturnValue({ label: '启用插件', activate });
  const pinia = createPinia();
  setActivePinia(pinia);
  useNavigationScope().enterProject('project');
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        widthPx: 300,
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain('已保存的快照'));
    expect(activate).not.toHaveBeenCalled();
    expect(ports.open).not.toHaveBeenCalled();
    const recovery = Array.from(host.querySelectorAll('button')).find(
      button => button.textContent === '启用插件'
    );
    if (!recovery) throw new Error('Recovery action missing');
    recovery.click();
    await vi.waitFor(() => expect(host.textContent).toContain('最新正文'));
    expect(activate).toHaveBeenCalledOnce();
    expect(ports.open).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('button.document-preview-title')?.click();
    await vi.waitFor(() =>
      expect(ports.open).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc', projectId: 'project' })
      )
    );
    ports.open.mockClear();
    ports.read.mockResolvedValue({
      ...identity,
      status: 'outside_project',
      title: null,
      path: null,
    });
    host.querySelector<HTMLButtonElement>('button.document-preview-title')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.open).not.toHaveBeenCalled();
  } finally {
    app.unmount();
    host.remove();
    ports.recovery.mockReset();
    vi.unstubAllGlobals();
  }
});
it('fades the detail viewport only while real content remains below', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  await import('@linnya/markdown-document-core');
  ports.read.mockResolvedValue({
    documentId: 'doc',
    status: 'available',
    title: 'Doc',
    nodeType: 'document',
    path: 'workspace:/Doc.md',
  });
  ports.preview.mockResolvedValue({
    documentId: 'doc',
    title: 'Doc',
    nodeType: 'document',
    status: 'ready',
    content: { revisionKey: '1', summary: '', detail: { format: 'markdown', text: '# Long' } },
  });
  ports.availability.mockReturnValue(ports.stopAvailability);
  const host = document.createElement('div'),
    pinia = createPinia();
  document.body.append(host);
  setActivePinia(pinia);
  useNavigationScope().enterProject('project');
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        detailOnly: true,
        widthPx: 320,
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Long'));
    const viewport = host.querySelector<HTMLElement>('.readonly-document-preview__viewport');
    if (!viewport) throw new Error('missing viewport');
    const scrollTo = async (scrollTop: number) => {
      Object.defineProperties(viewport, {
        scrollHeight: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 240 },
        scrollTop: { configurable: true, value: scrollTop },
      });
      viewport.dispatchEvent(new Event('scroll'));
      await nextTick();
      return host
        .querySelector('.readonly-document-preview')
        ?.classList.contains('document-preview-more-below');
    };
    expect(await scrollTo(0)).toBe(true);
    expect(await scrollTo(760 - DOCUMENT_PREVIEW_LAYOUT.paddingBottom)).toBe(false);
  } finally {
    app.unmount();
    host.remove();
    vi.unstubAllGlobals();
  }
});
it('界面文案跟随语言：读取中显示英文提示，读取失败显示可读提示而不是内部报错', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ports.availability.mockReturnValue(ports.stopAvailability);
  const host = document.createElement('div'),
    pinia = createPinia();
  document.body.append(host);
  setActivePinia(pinia);
  registerMessageCatalogs(DOCUMENT_PREVIEW_MESSAGE_CATALOG);
  useLocalizationStore().setCurrentLocale('en-US');
  useNavigationScope().enterProject('project');
  let fail: (reason: Error) => void = () => {};
  ports.read.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, { readTarget: () => ({ documentId: 'doc', projectId: 'project' }) }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain('Loading document preview…'));
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Read-only document preview'
    );
    fail(new Error('IPC channel workspace:preview rejected: SQLITE_BUSY'));
    await vi.waitFor(() =>
      expect(host.textContent).toContain('Unable to preview this document. Please try again later.')
    );
    expect(host.textContent).not.toContain('SQLITE_BUSY');
  } finally {
    app.unmount();
    clearLocalizationRegistryForTest();
    useLocalizationStore().setCurrentLocale('zh-CN');
  }
});
it('已删除目标的预览按界面语言显示，切换语言后原地重画', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  ports.availability.mockReturnValue(ports.stopAvailability);
  ports.read.mockResolvedValue({ documentId: 'doc', status: 'deleted', title: null, nodeType: null, path: null });
  ports.preview.mockResolvedValue({ documentId: 'doc', title: null, nodeType: null, status: 'deleted' });
  const host = document.createElement('div'),
    pinia = createPinia();
  document.body.append(host);
  setActivePinia(pinia);
  registerMessageCatalogs(DOCUMENT_PREVIEW_MESSAGE_CATALOG);
  const store = useLocalizationStore();
  store.setCurrentLocale('en-US');
  useNavigationScope().enterProject('project');
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        widthPx: 320,
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain('This document has been deleted'));
    expect(host.textContent).toContain('Document unavailable');
    expect(host.textContent).not.toMatch(/[一-龥]/);
    store.setCurrentLocale('zh-CN');
    await vi.waitFor(() => expect(host.textContent).toContain('文档已删除'));
    expect(host.textContent).toContain('文档当前不可访问');
  } finally {
    app.unmount();
    clearLocalizationRegistryForTest();
    store.setCurrentLocale('zh-CN');
  }
});
