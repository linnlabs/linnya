// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { DocumentImageAsset } from '@app/schemas';
import { CanvasCardIdSchema, type CanvasCommitResult } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasCardCreation, type CanvasCardCreationPort } from '..';
const asset: DocumentImageAsset = { assetId: 'asset', mediaType: 'image/png', byteLength: 3, width: 960, height: 480, displayWidth: 960, displayHeight: 480, sha256: 'a'.repeat(64), dataUri: 'data:image/png;base64,YWJj' };
async function fixture() {
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => ({ documentId: 'doc', requestId: input.requestId, sequence: 0, results: [], refs: { $image0: CanvasCardIdSchema.parse('c1'), $image1: CanvasCardIdSchema.parse('c2') } }));
  const document: CanvasDocumentPort = { read: async () => ({ schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [] }), commit, changes: vi.fn(), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(document); await session.open('doc');
  const prepareImage = vi.fn(async () => asset), select = vi.fn(async () => {});
  const port: CanvasCardCreationPort = { prepareImage, queryDocuments: async () => [] };
  const creation = createCanvasCardCreation(session, port, () => ({ x: 0, y: 0 }), select);
  return { session, creation, commit, prepareImage, select };
}
it('多图准备全部成功后一次提交与选择，任何一张失败不留下半批卡片', async () => {
  const f = await fixture(), files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })];
  f.prepareImage.mockRejectedValueOnce(new Error('invalid_image'));
  await expect(f.creation.importFiles(files)).rejects.toThrow('invalid_image'); expect(f.commit).not.toHaveBeenCalled();
  f.prepareImage.mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error('second invalid'));
  await expect(f.creation.importFiles(files)).rejects.toThrow('second invalid'); expect(f.commit).not.toHaveBeenCalled();
  await f.creation.importFiles(files, { x: 10, y: 20 }); expect(f.commit).toHaveBeenCalledOnce();
  expect(f.commit.mock.calls[0]?.[0].operations).toMatchObject([{ op: 'addImage', width: 480, height: 240, x: 10, y: 20 }, { op: 'addImage', x: 34, y: 44 }]);
  expect(f.select).toHaveBeenCalledWith(['c1', 'c2']); f.creation.dispose(); await f.session.close();
});
it('文档选择器保留打开菜单时的位置，异步选文档不改成视口中心', async () => {
  const f = await fixture(); await f.creation.showDocuments({ x: 410, y: 220 }); await f.creation.addDocument('target-document');
  expect(f.commit.mock.calls[0]?.[0].operations).toMatchObject([{ op: 'addDocument', x: 410, y: 220 }]);
  f.creation.dispose(); await f.session.close();
});
it('旋转照片按显示尺寸建框，编码尺寸和原资产身份保持不变', async () => {
  const f = await fixture();
  f.prepareImage.mockResolvedValueOnce({ ...asset, mediaType: 'image/jpeg', width: 120, height: 80, displayWidth: 80, displayHeight: 120 });
  await f.creation.importFiles([new File(['jpeg'], 'portrait.jpg', { type: 'image/jpeg' })]);
  expect(f.commit.mock.calls[0]?.[0].operations).toMatchObject([{ op: 'addImage', width: 80, height: 120, data: { assetId: asset.assetId } }]);
  f.creation.dispose(); await f.session.close();
});
it('文档候选不含当前画布自身', async () => {
  const f = await fixture(), candidate = (documentId: string) => ({ documentId, title: documentId, nodeType: 'document', path: `workspace:/${documentId}`, projectId: 'project' });
  const creation = createCanvasCardCreation(f.session, { prepareImage: f.prepareImage, queryDocuments: async () => [candidate('doc'), candidate('notes')] }, () => ({ x: 0, y: 0 }), f.select);
  await creation.showDocuments();
  expect(creation.picker.candidates.value.map(item => item.documentId)).toEqual(['notes']);
  creation.dispose(); f.creation.dispose(); await f.session.close();
});
