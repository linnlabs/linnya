import type { CanvasCardId } from '@plugin/canvas/shared';
import { requireWritableCanvas, type CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasImageEditingPort } from '../definitions/canvasImageEditing';
import { createCanvasImageEditingState } from '../store/createCanvasImageEditingState';
import { resolveCanvasImageEditingTarget } from '../functions/resolveCanvasImageEditingTarget';
import {
  buildCanvasImageEditingPatch,
  canvasImageReplacementData,
} from '../functions/buildCanvasImageEditingPatch';

const editingFields = ['data', 'x', 'y', 'width', 'height'] as const;

/** 图片只编辑可见范围和元数据；准备新资产不建立归属，正式提交与撤销沿用内容事务。 */
export function createCanvasImageEditing(
  session: CanvasDocumentSession,
  port: CanvasImageEditingPort
) {
  const state = createCanvasImageEditingState();
  let generation = 0;
  const fail = (error: unknown) =>
    state.fail(error instanceof Error ? error.message : String(error));
  const target = (id: CanvasCardId) =>
    resolveCanvasImageEditingTarget(requireWritableCanvas(session.state.snapshot.value), id);
  async function close() {
    generation++;
    const id = state.draft.value?.card.id;
    state.clear();
    // 视图关闭已统一释放声明；仍打开时只释放本图片编辑owner。
    if (id && session.state.phase.value === 'ready')
      await session.protect(id, [], 'image-properties');
  }
  return {
    state,
    close,
    deliveryNotice: session.deliveryNotice,
    retryDelivery: session.retryDelivery,
    dismiss() {
      void close().catch(fail);
    },
    async open(id: CanvasCardId) {
      await close();
      const card = target(id),
        documentId = requireWritableCanvas(session.state.snapshot.value).documentId;
      state.begin(card);
      state.setBusy(true);
      const token = ++generation;
      try {
        await session.protect(id, [...editingFields], 'image-properties');
        if (token !== generation) return;
        const asset = await port.readImage(documentId, card.data.assetId);
        if (token === generation) state.installAsset(asset, card.data);
      } catch (error) {
        if (token === generation) fail(error);
      } finally {
        if (token === generation) state.setBusy(false);
      }
    },
    async replace(file: File) {
      const draft = state.draft.value;
      if (!draft || state.busy.value) return;
      const token = generation;
      state.setBusy(true);
      try {
        const asset = await port.prepare(file);
        if (token === generation) {
          target(draft.card.id);
          state.installAsset(asset, canvasImageReplacementData(draft, asset.assetId));
        }
      } catch (error) {
        if (token === generation) fail(error);
      } finally {
        if (token === generation) state.setBusy(false);
      }
    },
    async apply() {
      const draft = state.draft.value;
      if (!draft || state.busy.value) return;
      state.setBusy(true);
      try {
        target(draft.card.id);
        await session.commit([
          {
            op: 'update',
            id: draft.card.id,
            baseRevision: draft.card.revision,
            patch: buildCanvasImageEditingPatch(draft),
          },
        ]);
        await close();
      } catch (error) {
        fail(error);
        state.setBusy(false);
      }
    },
    dispose() {
      void close().catch(fail);
    },
  };
}
