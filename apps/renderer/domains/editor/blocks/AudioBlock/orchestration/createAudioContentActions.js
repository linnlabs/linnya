import { useFileStore } from '@/app/active-document';
import { audioBlockRepository } from '../repository/audioRepository';
import { createEmptyTranscriptDocument } from '../types/audioBlock';
import { projectLoadedAudioContent } from '../functions/projectLoadedAudioContent';

export function createAudioContentActions(state) {
  function markDirty(blockId, contentType) {
    state._markDirty(blockId, contentType);
    useFileStore().setDirty(true);
  }
  async function loadContent(blockId) {
    const content = state.getContent(blockId);

    // 如果已加载，直接返回
    if (content.isLoaded) {
      console.log(`[AudioContentStore] Content already loaded for ${blockId}, skipping`);
      return { success: true };
    }

    console.log(`[AudioContentStore] Loading content for ${blockId}`);
    const result = await audioBlockRepository.loadCompleteContent(blockId);

    if (!result.success) {
      console.error(`[AudioContentStore] Failed to load content:`, result.error);
      return { success: false, error: result.error };
    }

    const data = result.data;

    state.patchContent(blockId, projectLoadedAudioContent(data));
    console.log(`[AudioContentStore] Content loaded for ${blockId}`);

    return { success: true };
  }

  async function persistDirtyContent() {
    const dirtyBlocks = state.getAllDirtyBlocks;

    if (dirtyBlocks.length === 0) {
      console.log('[AudioContentStore] No dirty content to persist');
      return { success: true };
    }

    console.log(`[AudioContentStore] Persisting ${dirtyBlocks.length} dirty blocks:`, dirtyBlocks);

    const fileStore = useFileStore();
    const documentNodeId = fileStore.currentFilePath;

    if (!documentNodeId) {
      console.error('[AudioContentStore] No document open, cannot persist');
      return { success: false, error: 'No document open' };
    }

    const promises = [];

    for (const { blockId, dirtyTypes } of dirtyBlocks) {
      const content = state.getContent(blockId);

      // 保存笔记
      if (dirtyTypes.includes('notes')) {
        promises.push(audioBlockRepository.saveNote(blockId, documentNodeId, content.notesContent));
      }

      // 保存转录
      if (dirtyTypes.includes('transcript')) {
        const transcriptDoc = content.transcriptContent || createEmptyTranscriptDocument();
        promises.push(
          audioBlockRepository.saveTranscript(blockId, documentNodeId, transcriptDoc, {
            translationLanguage: content.translationLanguage,
            translationVisible: content.translationVisible,
            textColumnWidth: content.textColumnWidth,
          })
        );
      }

      // 保存摘要
      if (dirtyTypes.includes('summary')) {
        promises.push(
          audioBlockRepository.saveSummary(blockId, documentNodeId, content.summaryContent)
        );
      }
    }

    const results = await Promise.all(promises);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      const errorMsg = `Failed to persist ${failed.length} content(s): ${failed.map(r => r.error).join(', ')}`;
      console.error('[AudioContentStore]', errorMsg);
      return { success: false, error: errorMsg };
    }

    // 清除所有"脏"标记
    state._clearAllDirty();
    console.log('[AudioContentStore] All dirty content persisted successfully');

    return { success: true };
  }

  function setNotesContentDraft(blockId, html) {
    state.patchContent(blockId, { notesContent: html });
    markDirty(blockId, 'notes');
  }

  function setTranscriptContentDraft(blockId, pmJson) {
    state.patchContent(blockId, { transcriptContent: pmJson });
    markDirty(blockId, 'transcript');
  }

  function setSummaryContentDraft(blockId, html) {
    state.patchContent(blockId, { summaryContent: html });
    markDirty(blockId, 'summary');
  }

  function setTranslationState(blockId, { language, visible, columnWidth }) {
    if (language !== undefined) state.patchContent(blockId, { translationLanguage: language });
    if (visible !== undefined) state.patchContent(blockId, { translationVisible: visible });
    if (columnWidth !== undefined) state.patchContent(blockId, { textColumnWidth: columnWidth });
    // 翻译状态改变时也标记 transcript 为脏
    markDirty(blockId, 'transcript');
  }
  return {
    loadContent,
    persistDirtyContent,
    setNotesContentDraft,
    setTranscriptContentDraft,
    setSummaryContentDraft,
    setTranslationState,
  };
}
