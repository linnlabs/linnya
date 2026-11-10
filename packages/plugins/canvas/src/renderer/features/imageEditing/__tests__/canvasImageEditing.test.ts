import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasImageCardSchema, CanvasImageCropSchema, type CanvasSnapshot, type CanvasCommitResult } from '@plugin/canvas/shared';
import type { DocumentImageAsset } from '@app/schemas';
import { CanvasDeliveryUnknownError, createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasImageEditing } from '../orchestration/createCanvasImageEditing';
import { canvasImageCropFromPoints, canvasImageCropInset, fullCanvasImageCrop } from '../functions/canvasImageCrop';
const card = CanvasImageCardSchema.parse({ id: 'c1', type: 'image', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false,
  createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 1, updatedAt: 1,
  x: 0, y: 0, width: 400, height: 200, parentId: null, data: { assetId: 'old', caption: '原图注', alt: '原替代文字', crop: null } });
const asset: DocumentImageAsset = { assetId: 'old', mediaType: 'image/png', byteLength: 1, width: 400, height: 200, displayWidth: 400, displayHeight: 200, sha256: 'a'.repeat(64), dataUri: 'data:image/png;base64,AA==' };
async function fixture() {
  let snapshot: CanvasSnapshot = { documentId: 'doc', schemaVersion: 1, sequence: 0, elements: [card] };
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => {
    const operation = input.operations[0]; if (operation?.op !== 'update') throw new Error('expected update');
    snapshot = { ...snapshot, sequence: snapshot.sequence + 1, elements: [CanvasImageCardSchema.parse({ ...card, ...operation.patch, revision: 2 })] };
    return { documentId: 'doc', requestId: input.requestId, sequence: snapshot.sequence, results: [{ index: 0, id: 'c1', status: 'applied', reason: null }], refs: {} };
  });
  const protection = vi.fn(async () => {});
  const session = createCanvasDocumentSession({ read: async () => snapshot, changes: async () => ({ kind: 'snapshot', snapshot }), commit, editing: protection, close: async () => {}, undo: async () => { throw new Error('not used'); }, subscribe: () => () => {} });
  await session.open('doc');
  const readImage = vi.fn(async () => asset), prepare = vi.fn(async () => ({ ...asset, assetId: 'new' }));
  const editor = createCanvasImageEditing(session, { readImage, prepare });
  return { editor, session, commit, protection, readImage, prepare };
}
afterEach(() => vi.restoreAllMocks());
describe('图片属性编辑闭环', () => {
  it('写入结果未知保持保存等待，模态内确认复用原请求，不提交第二个新意图', async () => {
    const f = await fixture();
    try {
      await f.editor.open(card.id); f.editor.state.patch({ caption: '待确认' });
      f.commit.mockRejectedValueOnce(new CanvasDeliveryUnknownError('receipt lost'));
      const saving = f.editor.apply();
      await vi.waitFor(() => expect(f.editor.deliveryNotice.value).toContain('重试确认'));
      expect(f.editor.state.busy.value).toBe(true);
      await f.editor.retryDelivery(); await saving;
      expect(f.commit.mock.calls[0]?.[0].requestId).toBe(f.commit.mock.calls[1]?.[0].requestId);
      expect(f.editor.state.draft.value).toBeNull();
    } finally { f.editor.dispose(); await f.session.close(); }
  });
  it('准备替换不写内容，保存图注/裁剪一次提交；失败保留草稿，成功释放声明', async () => {
    const f = await fixture();
    try {
      await f.editor.open(card.id);
      f.editor.state.patch({ caption: '新图注', crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } });
      await f.editor.replace(new File(['image'], 'new.png', { type: 'image/png' }));
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.editor.state.draft.value?.data).toMatchObject({ assetId: 'new', caption: '新图注', crop: null });
      f.editor.state.patch({ crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } });
      f.commit.mockRejectedValueOnce(new Error('storage failed'));
      await f.editor.apply(); expect(f.editor.state.draft.value?.data.caption).toBe('新图注'); expect(f.editor.state.error.value).toBe('storage failed');
      await f.editor.apply(); expect(f.editor.state.draft.value).toBeNull();
      expect(f.session.state.snapshot.value?.elements[0]).toMatchObject({ x: 40, y: 40, width: 320, height: 120, data: { assetId: 'new', caption: '新图注', alt: '原替代文字', crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } } });
      expect(f.protection).toHaveBeenLastCalledWith(expect.objectContaining({ claims: [] }));
    } finally { f.editor.dispose(); await f.session.close(); }
  });
  it('取消不会提交，迟到的替换结果不会重开草稿', async () => {
    const f = await fixture();
    try {
      await f.editor.open(card.id); let finish: ((value: DocumentImageAsset) => void) | undefined;
      f.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const replacing = f.editor.replace(new File(['image'], 'new.png'));
      await f.editor.close(); finish?.({ ...asset, assetId: 'late' }); await replacing;
      expect(f.editor.state.draft.value).toBeNull(); expect(f.commit).not.toHaveBeenCalled();
    } finally { f.editor.dispose(); await f.session.close(); }
  });
  it('反向拖动和键盘边界保持在原图内，非法裁剪在正式schema拒绝', () => {
    expect(canvasImageCropFromPoints({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toMatchObject({ x: 0.2, y: 0.1 });
    let crop = fullCanvasImageCrop;
    for (const side of ['left', 'right', 'top', 'bottom'] as const) { crop = canvasImageCropInset(crop, side, 99); expect(CanvasImageCropSchema.safeParse(crop).success).toBe(true); }
    expect(CanvasImageCropSchema.safeParse({ x: 0.8, y: 0, width: 0.4, height: 1 }).success).toBe(false);
  });
});
