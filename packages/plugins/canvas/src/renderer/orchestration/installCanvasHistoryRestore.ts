import { decodeCanvasHistorySession } from '@plugin/canvas/shared';
import { registerCanvasHistorySession, type CanvasDocumentSession } from '../features/canvasDocument';
import type { CanvasRestoredMessage, CanvasRestoreDraftParticipant } from '../definitions/canvasHistoryRestoration';

/** 恢复清理绑定Header打开时的编辑世代；不保存旧草稿，也不清之后的新输入。 */
export function installCanvasHistoryRestore(options: {
  readonly documentId: string; readonly session: CanvasDocumentSession;
  readonly participants: readonly CanvasRestoreDraftParticipant[];
  readonly subscribe: (listener: (message: CanvasRestoredMessage) => void) => () => void;
  readonly changed: () => void; readonly report: (error: unknown) => void;
}) {
  let disposed = false;
  let captured: { readonly id: string; readonly generations: readonly (string | null)[] } | null = null;
  const capture = () => {
    const generations = options.participants.map(participant => participant.readGeneration());
    if (!captured || generations.some((value, index) => value !== captured?.generations[index])) captured = { id: crypto.randomUUID(), generations };
    return captured.id;
  };
  const restore = async (message: CanvasRestoredMessage) => {
    if (message.documentId !== options.documentId) return;
    const token = decodeCanvasHistorySession(message.clientSessionId), attempt = captured;
    if (!token || token.viewId !== options.session.viewId || token.captureId !== attempt?.id) return;
    await options.session.synchronize(message.sequence);
    if (disposed || captured !== attempt) return;
    options.participants.forEach((participant, index) => {
      const generation = attempt.generations[index];
      if (generation !== null && participant.readGeneration() === generation) participant.discard();
    });
    captured = null; options.changed();
  };
  const remove = registerCanvasHistorySession(options.documentId, options.session.viewId, capture);
  const unsubscribe = options.subscribe(message => { void restore(message).catch(options.report); });
  return () => { disposed = true; remove(); unsubscribe(); captured = null; };
}
