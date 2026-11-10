import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasTextEditingLease } from '../definitions/cardEditing';
import { canvasText } from '../../localization';

/** 每次打开使用独立owner，旧异步清理不能释放新编辑（包括同一张卡）的保护。 */
export function createCanvasTextProtection(
  session: CanvasDocumentSession,
  failed: (message: string) => void
) {
  let renewing: CanvasTextEditingLease | null = null;
  function stop(lease?: CanvasTextEditingLease) {
    if (lease && renewing !== lease) return;
    renewing = null;
  }
  const currentDocument = (lease: CanvasTextEditingLease) =>
    session.state.snapshot.value?.documentId === lease.documentId;
  const claim = (lease: CanvasTextEditingLease) =>
    session.protect(lease.elementId, ['data', 'height'], lease.owner);
  return {
    create(elementId: CanvasCardId): CanvasTextEditingLease {
      const documentId = session.state.snapshot.value?.documentId;
      if (!documentId) throw new Error(canvasText('canvas.error.notOpen'));
      return { elementId, documentId, owner: `text:${crypto.randomUUID()}` };
    },
    claim,
    start(lease: CanvasTextEditingLease) {
      stop();
      renewing = lease;
    },
    async release(lease: CanvasTextEditingLease) {
      stop(lease);
      // session.close已reset所有本地owner并由Host关闭视图；关闭后不能再向新文档投递旧保护。
      if (currentDocument(lease)) await session.protect(lease.elementId, [], lease.owner);
    },
    dispose() {
      const lease = renewing;
      stop();
      if (lease && currentDocument(lease))
        void session
          .protect(lease.elementId, [], lease.owner)
          .catch(error => failed(error instanceof Error ? error.message : String(error)));
    },
  };
}
