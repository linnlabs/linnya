/**
 * @file audioContent.store.js
 * @description AudioBlock 内容管理 Store
 * 
 * 职责：
 * - 管理笔记/转录/摘要的草稿状态
 * - 处理内容的加载与持久化
 * - 标记"脏"状态以便批量保存
 * - 不关心录音/播放等运行时状态
 */

import { defineStore } from 'pinia';
import { useFileStore } from '../../../../../shared/stores/file';
import { audioBlockRepository } from '../repository/audioRepository';
import { createEmptyTranscriptDocument } from '../types/audioBlock';

/**
 * 内容块状态结构
 */
function createContentState() {
  return {
    // 笔记内容
    notesContent: '',
    notesCreatedAt: null,
    notesLastEditedAt: null,
    
    // 转录内容
    transcriptContent: null,
    transcriptCreatedAt: null,
    transcriptLastEditedAt: null,
    
    // 翻译状态
    translationLanguage: null,
    translationVisible: false,
    textColumnWidth: 50,
    
    // 摘要内容
    summaryContent: '',
    summaryCreatedAt: null,
    summaryLastEditedAt: null,
    
    // 加载状态
    isLoaded: false,
  };
}

export const useAudioContentStore = defineStore('audioContent', {
  state: () => ({
    /** @type {Record<string, ReturnType<typeof createContentState>>} */
    contents: {},
    
    /** 
     * 标记需要持久化的"脏"块 
     * Map<blockId, Set<'notes' | 'transcript' | 'summary'>>
     */
    dirtyBlocks: new Map(),
  }),

  getters: {
    /**
     * 获取指定块的内容状态
     */
    getContent: (state) => (blockId) => {
      if (!state.contents[blockId]) {
        state.contents[blockId] = createContentState();
      }
      return state.contents[blockId];
    },

    /**
     * 检查指定块的指定内容是否为"脏"状态
     */
    isDirty: (state) => (blockId, contentType) => {
      const dirtySet = state.dirtyBlocks.get(blockId);
      return dirtySet ? dirtySet.has(contentType) : false;
    },

    /**
     * 获取所有"脏"块的信息
     */
    getAllDirtyBlocks: (state) => {
      const result = [];
      state.dirtyBlocks.forEach((dirtySet, blockId) => {
        result.push({
          blockId,
          dirtyTypes: Array.from(dirtySet),
        });
      });
      return result;
    },
  },

  actions: {
    /**
     * 初始化块的内容状态
     */
    initContent(blockId) {
      if (!this.contents[blockId]) {
        this.contents[blockId] = createContentState();
      }
    },

    /**
     * 更新笔记内容草稿（标记为"脏"）
     */
    setNotesContentDraft(blockId, html) {
      const content = this.getContent(blockId);
      content.notesContent = html;
      this._markDirty(blockId, 'notes');
    },

    /**
     * 更新转录内容草稿（标记为"脏"）
     */
    setTranscriptContentDraft(blockId, pmJson) {
      const content = this.getContent(blockId);
      content.transcriptContent = pmJson;
      this._markDirty(blockId, 'transcript');
    },

    /**
     * 更新摘要内容草稿（标记为"脏"）
     */
    setSummaryContentDraft(blockId, html) {
      const content = this.getContent(blockId);
      content.summaryContent = html;
      this._markDirty(blockId, 'summary');
    },

    /**
     * 更新翻译相关状态（不单独标记为脏，随 transcript 一起保存）
     */
    setTranslationState(blockId, { language, visible, columnWidth }) {
      const content = this.getContent(blockId);
      if (language !== undefined) content.translationLanguage = language;
      if (visible !== undefined) content.translationVisible = visible;
      if (columnWidth !== undefined) content.textColumnWidth = columnWidth;
      // 翻译状态改变时也标记 transcript 为脏
      this._markDirty(blockId, 'transcript');
    },


    /**
     * 从数据库加载内容（幂等操作）
     */
    async loadContent(blockId) {
      const content = this.getContent(blockId);
      
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

      // 更新笔记
      if (data.note) {
        content.notesContent = data.note.content_html || '';
        content.notesCreatedAt = data.note.created_at;
        content.notesLastEditedAt = data.note.updated_at;
      }

      // 更新转录
      if (data.transcript) {
        content.transcriptContent = audioBlockRepository.parseTranscriptContent(
          data.transcript.content_json
        );
        content.transcriptCreatedAt = data.transcript.created_at;
        content.transcriptLastEditedAt = data.transcript.updated_at;
        content.translationLanguage = data.transcript.translation_language || null;
        content.translationVisible = !!data.transcript.translation_visible;
        content.textColumnWidth = typeof data.transcript.text_column_width === 'number' 
          ? data.transcript.text_column_width 
          : 50;
      }

      // 更新摘要
      if (data.summary) {
        content.summaryContent = data.summary.content_html || '';
        content.summaryCreatedAt = data.summary.created_at;
        content.summaryLastEditedAt = data.summary.updated_at;
      }

      content.isLoaded = true;
      console.log(`[AudioContentStore] Content loaded for ${blockId}`);

      return { success: true };
    },

    /**
     * 持久化所有"脏"块的内容
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async persistDirtyContent() {
      const dirtyBlocks = this.getAllDirtyBlocks;
      
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
        const content = this.getContent(blockId);

        // 保存笔记
        if (dirtyTypes.includes('notes')) {
          promises.push(
            audioBlockRepository.saveNote(blockId, documentNodeId, content.notesContent)
          );
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
      this._clearAllDirty();
      console.log('[AudioContentStore] All dirty content persisted successfully');

      return { success: true };
    },

    /**
     * 清理块状态（组件卸载时调用）
     * 注意：只清理"脏"标记，保留已加载的内容数据，以便页面切换后快速恢复
     */
    cleanupBlock(blockId) {
      // 只清理脏标记，保留内容数据
      this.dirtyBlocks.delete(blockId);
      console.log(`[AudioContentStore] Cleaned up dirty flags for block: ${blockId}, content retained`);
    },

    /**
     * 标记内容为"脏"
     * @private
     */
    _markDirty(blockId, contentType) {
      if (!this.dirtyBlocks.has(blockId)) {
        this.dirtyBlocks.set(blockId, new Set());
      }
      this.dirtyBlocks.get(blockId).add(contentType);
      console.log(`[AudioContentStore] Marked ${blockId}/${contentType} as dirty`);

      // 同时标记文档为已修改
      const fileStore = useFileStore();
      fileStore.setDirty(true);
    },

    /**
     * 清除所有"脏"标记
     * @private
     */
    _clearAllDirty() {
      this.dirtyBlocks.clear();
    },
  },
});
