import { notifyWorkspaceDocumentOpened, showWorkspaceNotification, throwIfFileSessionOpenCancelled, type FileTypeLifecycleHandler } from '@plugin/renderer/workspaceRuntime';
import { CANVAS_DOCUMENT_TYPE } from '@plugin/canvas/shared';
import { saveCanvasDocumentDrafts } from './ports/canvasSaveParticipants';

export const canvasFileHandler: FileTypeLifecycleHandler = {
  type: CANVAS_DOCUMENT_TYPE,
  async open(session) {
    throwIfFileSessionOpenCancelled(session);
    const result = await notifyWorkspaceDocumentOpened({ documentId: session.documentId });
    if (!result.success) throw new Error(result.error);
    throwIfFileSessionOpenCancelled(session);
  },
  async save({ session, reason }) {
    try { return await saveCanvasDocumentDrafts(session.documentId, reason !== 'auto'); }
    catch (error) { showWorkspaceNotification(error instanceof Error ? error.message : String(error), 'error', 5000); return false; }
  },
};
