// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation, WorkspaceMutationEvent } from '@app/schemas';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization';
import { DOCUMENT_PREVIEW_MESSAGE_CATALOG } from '../definitions/documentPreviewMessageCatalog';
import { createDocumentPreviewController } from '../orchestration/createDocumentPreviewController';
const ports = vi.hoisted(() => ({
  read: vi.fn(),
  preview: vi.fn(),
  open: vi.fn(),
  stopMutation: vi.fn(),
  stopAvailability: vi.fn(),
  emit: (_event: unknown) => {},
}));
vi.mock('@plugin/renderer/workspaceNavigation', () => ({
  getWorkspaceNavigationPort: () => ({ openDocumentByNodeType: ports.open }),
}));
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: ports.read }));
vi.mock('@plugin/renderer/documentPreview', () => ({ readDocumentPreview: ports.preview }));
vi.mock('@plugin/renderer/pluginRuntime', () => ({
  subscribeRendererPluginAvailability: () => ports.stopAvailability,
}));
vi.mock('@/shared/ipc/workspaceMutationSubscription', () => ({
  subscribeToWorkspaceMutation: (callback: (event: unknown) => void) => {
    ports.emit = callback;
    return ports.stopMutation;
  },
}));
const target = { documentId: 'document', projectId: 'project' };
const available: DocumentReferencePresentation = {
  documentId: 'document',
  status: 'available',
  title: '新标题',
  nodeType: 'markdown',
  path: 'workspace:/文档.md',
};
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearLocalizationRegistryForTest();
});
it('hover读取正式预览；卸载后释放订阅并丢弃迟到结果', async () => {
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValue({
    documentId: 'document',
    title: '当前标题',
    nodeType: 'markdown',
    status: 'ready',
    content: { revisionKey: 'v2', summary: '新摘要' },
  });
  const controller = createDocumentPreviewController(
    () => target,
    () => 'project'
  );
  await controller.refresh();
  expect(controller.result.value?.preview.content?.summary).toBe('新摘要');
  let finish: ((value: DocumentReferencePresentation) => void) | undefined;
  ports.read.mockImplementationOnce(
    () =>
      new Promise<DocumentReferencePresentation>(resolve => {
        finish = resolve;
      })
  );
  const pending = controller.refresh();
  controller.dispose();
  finish?.(available);
  await pending;
  expect(controller.result.value).toBeNull();
  expect(ports.preview).toHaveBeenCalledTimes(1);
  expect(ports.stopMutation).toHaveBeenCalledTimes(1);
  expect(ports.stopAvailability).toHaveBeenCalledTimes(1);
});
it('异步切项目拒绝预览，不从旧项目继续读取正文', async () => {
  let project: string | null = 'project';
  ports.read.mockImplementationOnce(async () => {
    project = 'foreign';
    return available;
  });
  const controller = createDocumentPreviewController(
    () => target,
    () => project
  );
  try {
    await controller.refresh();
    expect(controller.error.value).toContain('不在当前项目');
    expect(ports.preview).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

const ready = (revisionKey: string) => ({
  documentId: 'document',
  title: '当前标题',
  nodeType: 'markdown',
  status: 'ready',
  content: { revisionKey, summary: '摘要' },
});
function deferredPreview() {
  let finish: (value: ReturnType<typeof ready>) => void = () => {};
  ports.preview.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  return (value: ReturnType<typeof ready>) => finish(value);
}
it('同一文档重新读取期间旧内容留在原处，读完替换；内容没变不换结果对象', async () => {
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValueOnce(ready('v1'));
  const controller = createDocumentPreviewController(
    () => target,
    () => 'project'
  );
  try {
    await controller.refresh();
    const shown = controller.result.value;
    expect(shown).not.toBeNull();

    let finish = deferredPreview();
    let pending = controller.refresh();
    await vi.waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(2));
    expect(controller.result.value).toBe(shown);
    finish(ready('v1'));
    await pending;
    expect(controller.result.value).toBe(shown);

    finish = deferredPreview();
    pending = controller.refresh();
    await vi.waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(3));
    expect(controller.result.value).toBe(shown);
    finish(ready('v2'));
    await pending;
    expect(controller.result.value?.preview.content?.revisionKey).toBe('v2');
  } finally {
    controller.dispose();
  }
});
it('换了目标立即撤下旧内容；读取失败也不留旧内容', async () => {
  let current = target;
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValueOnce(ready('v1'));
  const controller = createDocumentPreviewController(
    () => current,
    () => 'project'
  );
  try {
    await controller.refresh();
    expect(controller.result.value).not.toBeNull();

    current = { documentId: 'other', projectId: 'project' };
    const finish = deferredPreview();
    const pending = controller.refresh();
    expect(controller.result.value).toBeNull();
    await vi.waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(2));
    finish(ready('other'));
    await pending;
    expect(controller.result.value?.target.documentId).toBe('other');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('IPC channel workspace:preview rejected: SQLITE_BUSY');
    ports.preview.mockRejectedValueOnce(failure);
    await controller.refresh();
    expect(controller.result.value).toBeNull();
    // 内部报错只进日志，界面只给用户可读的提示。
    expect(controller.error.value).toBe('无法预览此文档，请稍后重试。');
    expect(warn).toHaveBeenCalledWith('[document-preview] failed', failure);
  } finally {
    controller.dispose();
  }
});
it('失败提示跟随界面语言，不显示内部报错原文', async () => {
  registerMessageCatalogs(DOCUMENT_PREVIEW_MESSAGE_CATALOG);
  useLocalizationStore().setCurrentLocale('en-US');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ports.read.mockRejectedValue(new Error('SQLITE_BUSY'));
  const controller = createDocumentPreviewController(
    () => target,
    () => 'project'
  );
  try {
    await controller.refresh();
    expect(controller.error.value).toBe('Unable to preview this document. Please try again later.');
    let project: string | null = 'project';
    ports.read.mockImplementationOnce(async () => {
      project = 'foreign';
      return available;
    });
    const scoped = createDocumentPreviewController(
      () => target,
      () => project
    );
    await scoped.refresh();
    expect(scoped.error.value).toBe(
      'This document is not in the current project, so it cannot be previewed.'
    );
    scoped.dispose();
  } finally {
    controller.dispose();
  }
});
it('打开文档失败时给通用提示并保留原因在日志里', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValue(ready('v1'));
  const failure = new Error('navigation port exploded');
  ports.open.mockRejectedValueOnce(failure);
  const controller = createDocumentPreviewController(
    () => target,
    () => 'project'
  );
  try {
    await controller.refresh();
    const shown = controller.result.value;
    if (!shown) throw new Error('preview missing');
    await controller.open(shown);
    expect(controller.error.value).toBe('无法打开此文档，请稍后重试。');
    expect(warn).toHaveBeenCalledWith('[document-preview] failed', failure);
  } finally {
    controller.dispose();
  }
});

function folderEvent(
  type: 'workspace.node.renamed' | 'workspace.node.deleted',
  projectId: string | null
): WorkspaceMutationEvent {
  return type === 'workspace.node.renamed'
    ? { type, mutationId: 'm', projectId, nodeId: 'folder', nodeType: 'folder', parentId: null, name: 'new', oldName: 'old' }
    : { type, mutationId: 'm', projectId, nodeId: 'folder', nodeType: 'folder', parentId: null, name: 'old', deletedNodeIds: ['folder'] };
}
it('只有目标所在项目的文件夹事件才重新读取预览', async () => {
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValue(ready('v1'));
  const controller = createDocumentPreviewController(
    () => target,
    () => 'project'
  );
  try {
    await controller.refresh();
    const reads = () => ports.read.mock.calls.length;
    const base = reads();
    ports.emit(folderEvent('workspace.node.renamed', 'other-project'));
    ports.emit(folderEvent('workspace.node.deleted', 'other-project'));
    ports.emit({
      type: 'workspace.node.transferred', mutationId: 'm', nodeId: 'folder', nodeType: 'folder', name: 'f',
      sourceProjectId: 'a', sourceParentId: null, targetProjectId: 'b', targetParentId: null, movedNodeIds: ['folder'],
    });
    await Promise.resolve();
    expect(reads()).toBe(base);

    ports.emit(folderEvent('workspace.node.renamed', 'project'));
    await vi.waitFor(() => expect(reads()).toBe(base + 1));
    ports.emit(folderEvent('workspace.node.deleted', null));
    await vi.waitFor(() => expect(reads()).toBe(base + 2));
    ports.emit({
      type: 'workspace.node.transferred', mutationId: 'm', nodeId: 'folder', nodeType: 'folder', name: 'f',
      sourceProjectId: 'a', sourceParentId: null, targetProjectId: 'project', targetParentId: null, movedNodeIds: ['folder'],
    });
    await vi.waitFor(() => expect(reads()).toBe(base + 3));
  } finally {
    controller.dispose();
  }
});
