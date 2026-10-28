import { showWorkspaceNotification, throwIfFileSessionOpenCancelled, type FileTypeLifecycleHandler } from '@plugin/renderer/workspaceRuntime';
import { SLIDES_ACTIVE_DOCUMENT_TYPE } from '@plugin/slides/shared/pluginMeta';
import { useSlidesDocumentRuntime } from './orchestration/useSlidesDocumentRuntime';
import { saveSlidesDocument } from './ports/documentSaveParticipant';

/** 接入 Host 已有的保存→关闭→切换顺序；不在组件卸载后补救未提交操作。 */
export const slidesFileHandler: FileTypeLifecycleHandler = {
  type: SLIDES_ACTIVE_DOCUMENT_TYPE,
  async open(session) {
    throwIfFileSessionOpenCancelled(session);
    const runtime = useSlidesDocumentRuntime();
    await runtime.loadDeck(session.documentId);
    throwIfFileSessionOpenCancelled(session);
    const parameters = session.payload?.navigationParameters;
    const slideNumber = typeof parameters === 'object' && parameters !== null && 'slideNumber' in parameters
      ? parameters.slideNumber : undefined;
    if (typeof slideNumber === 'number' && Number.isFinite(slideNumber) && slideNumber > 0) {
      await runtime.openDeckAtSlide(session.documentId, slideNumber);
    }
  },
  async save({ session, reason }) {
    try {
      return await saveSlidesDocument(session.documentId, reason !== 'auto');
    } catch (error) {
      showWorkspaceNotification(error instanceof Error ? error.message : String(error), 'error', 4000);
      return false;
    }
  },
  async close() { useSlidesDocumentRuntime().closeDeck(); },
};
