/**
 * @file src/electron-main/ipc/handlers/documents/markdown_document/audio-block-ipc.ts
 * @description AudioBlock 专属的 IPC 通道处理器 (Markdown 文档)
 */

import { AudioBlockService } from 'src/domains/markdown';
import { Logger } from '../../../../../../shared/logger';
import type { BackendRuntimeOwner } from '../../../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('AudioBlockIPC');

export function registerAudioBlockHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  const services = runtimeOwner.getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌ DatabaseService not available!');
    throw new Error('DatabaseService not available for AudioBlock handlers');
  }

  ipcMain.handle('audio-block:get-all-content', async (event, { audioBlockId }) => {
    try {
      const db = databaseService.getDb();
      const audioBlockService = new AudioBlockService(db);
      const content = audioBlockService.getCompleteAudioBlock(audioBlockId);

      // Map DB fields (content_text) to frontend expected fields (content_html)
      const mapped = {
        block: content.block,
        transcript: content.transcript,
        note: content.note
          ? { ...content.note, content_html: content.note.content_text }
          : null,
        summary: content.summary
          ? { ...content.summary, content_html: content.summary.content_text }
          : null,
      };

      return { success: true, data: mapped };
    } catch (error: unknown) {
      logger.error('[audio-block:get-all-content] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('audio-block:update-note', async (event, { audioBlockId, documentNodeId, content }) => {
    try {
      const db = databaseService.getDb();
      const audioBlockService = new AudioBlockService(db);
      audioBlockService.upsertNote(audioBlockId, documentNodeId, content);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[audio-block:update-note] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('audio-block:update-transcript', async (event, { audioBlockId, documentNodeId, content, translationLanguage, translationVisible, textColumnWidth }) => {
    try {
      const db = databaseService.getDb();
      const audioBlockService = new AudioBlockService(db);
      // The content is now a JSON string, which is what the service expects.
      audioBlockService.upsertTranscript({ 
        audioBlockId, 
        documentNodeId, 
        contentJson: content,
        translationLanguage: translationLanguage ?? null,
        translationVisible: !!translationVisible,
        textColumnWidth: typeof textColumnWidth === 'number' ? textColumnWidth : 50,
      });
      return { success: true };
    } catch (error: unknown) {
      logger.error('[audio-block:update-transcript] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('audio-block:update-summary', async (event, { audioBlockId, documentNodeId, content }) => {
    try {
      const db = databaseService.getDb();
      const audioBlockService = new AudioBlockService(db);
      audioBlockService.upsertSummary(audioBlockId, documentNodeId, content);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[audio-block:update-summary] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
