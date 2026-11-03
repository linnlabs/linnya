// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import { createWorkspaceReferencePreview } from './createWorkspaceReferencePreview';
const ports = vi.hoisted(() => ({ read: vi.fn(), preview: vi.fn(), stopMutation: vi.fn(), stopAvailability: vi.fn() }));
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: ports.read }));
vi.mock('@plugin/renderer/documentPreview', () => ({ readDocumentPreview: ports.preview }));
vi.mock('@plugin/renderer/pluginRuntime', () => ({ subscribeRendererPluginAvailability: () => ports.stopAvailability }));
vi.mock('@/shared/ipc/workspaceMutationSubscription', () => ({ subscribeToWorkspaceMutation: () => ports.stopMutation }));
const reference = { id: 'ref', pluginId: 'platform', kind: 'workspace-document', label: '文档', previewText: '', text: '', metadata: { documentId: 'document', projectId: 'project' } };
const available: DocumentReferencePresentation = { documentId: 'document', status: 'available', title: '新标题', nodeType: 'markdown', path: 'workspace:/文档.md' };
afterEach(() => vi.clearAllMocks());
it('hover读取正式预览；卸载后释放订阅并丢弃迟到结果', async () => {
  ports.read.mockResolvedValue(available);
  ports.preview.mockResolvedValue({ documentId: 'document', title: '当前标题', nodeType: 'markdown', status: 'ready', content: { revisionKey: 'v2', summary: '新摘要' } });
  const controller = createWorkspaceReferencePreview(reference, () => 'project');
  await controller.refresh();
  expect(controller.result.value?.preview.content?.summary).toBe('新摘要');
  let finish: ((value: DocumentReferencePresentation) => void) | undefined;
  ports.read.mockImplementationOnce(() => new Promise<DocumentReferencePresentation>(resolve => { finish = resolve; }));
  const pending = controller.refresh(); controller.dispose(); finish?.(available); await pending;
  expect(controller.result.value).toBeNull(); expect(ports.preview).toHaveBeenCalledTimes(1);
  expect(ports.stopMutation).toHaveBeenCalledTimes(1); expect(ports.stopAvailability).toHaveBeenCalledTimes(1);
});
it('异步切项目拒绝预览，不从旧项目继续读取正文', async () => {
  let project: string | null = 'project';
  ports.read.mockImplementationOnce(async () => { project = 'foreign'; return available; });
  const controller = createWorkspaceReferencePreview(reference, () => project);
  try {
    await controller.refresh();
    expect(controller.error.value).toContain('不在当前项目'); expect(ports.preview).not.toHaveBeenCalled();
  } finally { controller.dispose(); }
});
