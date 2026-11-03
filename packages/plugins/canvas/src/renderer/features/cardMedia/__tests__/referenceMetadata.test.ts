import { expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation, WorkspaceMutationEvent } from '@app/schemas';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import { createCanvasReferenceMetadata } from '../orchestration/createCanvasReferenceMetadata';
import type { CanvasCardMediaPort } from '..';
const card = CanvasDocumentCardSchema.parse({ id: 'c1', type: 'document', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { documentId: 'target' } });
const presentation = (title: string, status: DocumentReferencePresentation['status'] = 'available'): DocumentReferencePresentation => ({ documentId: 'target', status, title: status === 'outside_project' ? null : title, nodeType: 'markdown', path: status === 'outside_project' ? null : `workspace:/${title}` });
function fixture() {
  let workspace: ((event: WorkspaceMutationEvent) => void) | null = null, availability: ((types: readonly string[]) => void) | null = null;
  const reference = vi.fn(async () => presentation('原名'));
  const port: CanvasCardMediaPort = { reference, readImage: vi.fn(), preview: vi.fn(), projectId: () => 'project', openDocument: vi.fn(), subscribe: listener => { workspace = listener; return () => { workspace = null; }; }, subscribeAvailability: listener => { availability = listener; return () => { availability = null; }; } };
  const metadata = createCanvasReferenceMetadata(port);
  return { metadata, reference, rename: () => workspace?.({ type: 'workspace.node.renamed', nodeId: 'target', projectId: 'project', mutationId: 'rename', nodeType: 'markdown', parentId: null, name: '新名', oldName: '原名' }), availability: (types: readonly string[]) => availability?.(types) };
}
it('重命名时旧异步身份不能恢复旧标题，位图键及时失效', async () => {
  const f = fixture(); let resolveOld!: (value: DocumentReferencePresentation) => void;
  f.reference.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const old = f.metadata.refresh([card]); const previous = f.metadata.key(card);
  f.reference.mockResolvedValueOnce(presentation('新名')); f.rename(); resolveOld(presentation('原名')); await old;
  expect(f.metadata.titles().get('target')).toBe('新名'); expect(f.metadata.key(card)).not.toBe(previous); f.metadata.dispose();
});
it('只刷新相关插件目标，重新启用和跨项目后标题/搜索同步失效', async () => {
  const f = fixture(); await f.metadata.refresh([card]);
  f.availability(['slides']); expect(f.reference).toHaveBeenCalledTimes(1);
  f.reference.mockResolvedValueOnce(presentation('原名', 'plugin_unavailable')); f.availability(['markdown']); await f.metadata.refresh([card]);
  expect(f.reference).toHaveBeenCalledTimes(2); expect(f.metadata.titles().get('target')).toBe('原名');
  f.reference.mockResolvedValueOnce(presentation('', 'outside_project')); f.rename(); await f.metadata.refresh([card]);
  expect(f.metadata.titles().has('target')).toBe(false); f.metadata.dispose(); f.rename(); expect(f.reference).toHaveBeenCalledTimes(3);
});
