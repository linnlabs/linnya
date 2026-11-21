// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation, WorkspaceMutationEvent } from '@app/schemas';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { EDITOR_MESSAGE_CATALOG } from '../../../definitions/editorMessageCatalog';
import { createDocumentReferenceUiPort } from '../adapters/createDocumentReferenceUiPort';

const host = vi.hoisted(() => ({
  notify: vi.fn(),
  read: vi.fn(),
  emit: (_event: unknown) => {},
  projectId: 'project',
}));
vi.mock('@plugin/renderer/documentReferences', () => ({
  readDocumentReference: host.read,
  queryDocumentReferences: vi.fn(),
}));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  getCurrentWorkspaceProjectId: () => host.projectId,
  showWorkspaceNotification: host.notify,
}));
vi.mock('@plugin/renderer/pluginRuntime', () => ({ subscribeRendererPluginAvailability: () => () => {} }));
vi.mock('@shared/ipc/workspaceMutationSubscription', () => ({
  subscribeToWorkspaceMutation: (callback: (event: unknown) => void) => {
    host.emit = callback;
    return () => {};
  },
}));
const available: DocumentReferencePresentation = {
  documentId: 'target',
  title: 'Target',
  nodeType: 'document',
  path: 'workspace:/Target.md',
  status: 'available',
};
beforeEach(() => {
  setActivePinia(createPinia());
  host.projectId = 'project';
  host.read.mockResolvedValue(available);
});
afterEach(() => {
  vi.clearAllMocks();
  clearLocalizationRegistryForTest();
});

it('无法打开引用时的提示跟随界面语言', async () => {
  const port = createDocumentReferenceUiPort();
  const shown = async (status: DocumentReferencePresentation['status']) => {
    host.notify.mockClear();
    await port.open({ ...available, status });
    return host.notify.mock.calls[0]?.[0];
  };
  expect(await shown('deleted')).toBe('引用的文档已删除');
  registerMessageCatalogs(EDITOR_MESSAGE_CATALOG);
  useLocalizationStore().setCurrentLocale('en-US');
  expect(await shown('deleted')).toBe('The referenced document has been deleted');
  expect(await shown('outside_project')).toBe('This document is in another project and cannot be opened from here');
  expect(await shown('plugin_unavailable')).toBe('Enable or install the required plugin to open this document');
  port.dispose();
});

const folder = (type: 'workspace.node.renamed' | 'workspace.node.moved', projectId: string | null): WorkspaceMutationEvent =>
  type === 'workspace.node.renamed'
    ? { type, mutationId: 'm', projectId, nodeId: 'folder', nodeType: 'folder', parentId: null, name: 'b', oldName: 'a' }
    : { type, mutationId: 'm', projectId, nodeId: 'folder', nodeType: 'folder', parentId: null, oldParentId: null, name: 'a' };

it('只有当前项目的文件夹事件才让引用缓存失效并通知重读', async () => {
  const port = createDocumentReferenceUiPort();
  const changed = vi.fn();
  port.subscribe('target', changed);
  await port.resolve('target');
  expect(port.readCached('target')).not.toBeNull();

  host.emit(folder('workspace.node.renamed', 'other-project'));
  host.emit(folder('workspace.node.moved', 'other-project'));
  expect(changed).not.toHaveBeenCalled();
  expect(port.readCached('target')).not.toBeNull();

  host.emit(folder('workspace.node.renamed', 'project'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(port.readCached('target')).toBeNull();

  await port.resolve('target');
  host.emit(folder('workspace.node.moved', null));
  expect(changed).toHaveBeenCalledTimes(2);

  // 别的项目里被删除的文档仍按身份命中，不受项目过滤影响。
  await port.resolve('target');
  host.emit({
    type: 'workspace.node.deleted', mutationId: 'm', projectId: 'other-project', nodeId: 'target',
    nodeType: 'document', parentId: null, name: 'Target', deletedNodeIds: ['target'],
  });
  expect(changed).toHaveBeenCalledTimes(3);
  port.dispose();
});
