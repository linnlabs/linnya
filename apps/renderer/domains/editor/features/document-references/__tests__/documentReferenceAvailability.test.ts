// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import type { RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
import { registerRendererPluginRuntimePort } from '@plugin/renderer/pluginRuntime';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { createDocumentReferenceUiPort } from '../adapters/createDocumentReferenceUiPort';
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: vi.fn(), queryDocumentReferences: vi.fn() }));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({ getCurrentWorkspaceProjectId: () => 'project', showWorkspaceNotification: vi.fn() }));
vi.mock('@shared/ipc/workspaceMutationSubscription', () => ({ subscribeToWorkspaceMutation: () => () => {} }));

it('invalidates plugin-owned presentations without letting an earlier response re-populate the cache', async () => {
  let availabilityChanged: ((changes: readonly RendererPluginAvailabilityChange[]) => void) | undefined;
  const unsubscribe = vi.fn();
  registerRendererPluginRuntimePort({ read: () => 'enabled', subscribe(listener) { availabilityChanged = listener; return unsubscribe; } });
  const available: DocumentReferencePresentation = { documentId: 'target', title: 'Slides', nodeType: 'slides', path: 'workspace:/Slides.slides', status: 'available' };
  let finishOld: ((value: DocumentReferencePresentation) => void) | undefined;
  vi.mocked(readDocumentReference).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValue({ ...available, status: 'plugin_unavailable' });
  const port = createDocumentReferenceUiPort(); const changed = vi.fn(); port.subscribe('target', changed);
  const old = port.resolve('target');
  availabilityChanged?.([{ pluginId: 'slides', state: 'disabled', documentNodeTypes: ['slides'] }]);
  expect(changed).toHaveBeenCalledOnce(); expect(await port.resolve('target')).toMatchObject({ status: 'plugin_unavailable' });
  finishOld?.(available); await old;
  expect(port.readCached('target')?.status).toBe('plugin_unavailable');
  port.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
});
