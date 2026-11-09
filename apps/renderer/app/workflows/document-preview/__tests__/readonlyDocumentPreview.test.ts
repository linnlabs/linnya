// @vitest-environment jsdom
import { createApp, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { expect, it, vi } from 'vitest';
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

it('the first screen and expanded document share formal content and resize without scaling', async () => {
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
      ],
    },
  });
  const identity = {
    documentId: 'doc',
    status: 'available',
    title: '同一文档',
    nodeType: 'document',
    path: 'workspace:/Doc.md',
  };
  const preview = {
    documentId: 'doc',
    title: '同一文档',
    nodeType: 'document',
    status: 'ready',
    content: { revisionKey: '1', summary: 'Agent 摘要不能冒充正文', detail: content },
  };
  ports.read.mockResolvedValue(identity);
  ports.preview.mockResolvedValue(preview);
  ports.availability.mockReturnValue(ports.stopAvailability);
  const pinia = createPinia();
  setActivePinia(pinia);
  useNavigationScope().enterProject('project');
  const width = ref(280),
    host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(ReadonlyDocumentPreview, {
        readTarget: () => ({ documentId: 'doc', projectId: 'project' }),
        widthPx: width.value,
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain('正式正文'));
    expect(host.querySelector('.document-preview-first-screen')).not.toBeNull();
    expect(host.textContent).not.toContain('Agent 摘要');
    expect(host.querySelector('.workspace-markdown-preview')?.getAttribute('style')).toContain(
      '244px'
    );
    host.querySelector('.readonly-document-preview')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.waitFor(() => expect(host.querySelector('.document-preview-first-screen')).toBeNull());
    expect(host.textContent).toContain('正式正文');
    width.value = 420;
    await vi.waitFor(() =>
      expect(host.querySelector('.workspace-markdown-preview')?.getAttribute('style')).toContain(
        '384px'
      )
    );
    expect(ports.preview).toHaveBeenCalledOnce();
    expect(host.querySelector('[contenteditable]')).toBeNull();
  } finally {
    app.unmount();
    host.remove();
    vi.unstubAllGlobals();
  }
  expect(ports.stopMutation).toHaveBeenCalledOnce();
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
