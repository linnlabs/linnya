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
  readDocumentTypeRecoveryAction: () => null,
}));
it('detailOnly renders readonly Markdown immediately, blocks nested navigation and removes content on availability or project changes', async () => {
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
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Full detail'));
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
    app.unmount();
    host.remove();
  }
  expect(ports.stopMutation).toHaveBeenCalledOnce();
  expect(ports.stopAvailability).toHaveBeenCalledOnce();
});
