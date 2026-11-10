// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import { createDocumentPreviewController } from '../orchestration/createDocumentPreviewController';
const ports = vi.hoisted(() => ({
  read: vi.fn(),
  preview: vi.fn(),
  stopMutation: vi.fn(),
  stopAvailability: vi.fn(),
}));
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: ports.read }));
vi.mock('@plugin/renderer/documentPreview', () => ({ readDocumentPreview: ports.preview }));
vi.mock('@plugin/renderer/pluginRuntime', () => ({
  subscribeRendererPluginAvailability: () => ports.stopAvailability,
}));
vi.mock('@/shared/ipc/workspaceMutationSubscription', () => ({
  subscribeToWorkspaceMutation: () => ports.stopMutation,
}));
const target = { documentId: 'document', projectId: 'project' };
const available: DocumentReferencePresentation = {
  documentId: 'document',
  status: 'available',
  title: '新标题',
  nodeType: 'markdown',
  path: 'workspace:/文档.md',
};
afterEach(() => vi.clearAllMocks());
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

    ports.preview.mockRejectedValueOnce(new Error('读取失败'));
    await controller.refresh();
    expect(controller.result.value).toBeNull();
    expect(controller.error.value).toBe('读取失败');
  } finally {
    controller.dispose();
  }
});
