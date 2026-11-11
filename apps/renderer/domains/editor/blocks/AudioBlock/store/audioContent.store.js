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
    getContent: state => blockId => {
      if (!state.contents[blockId]) {
        state.contents[blockId] = createContentState();
      }
      return state.contents[blockId];
    },

    /**
     * 检查指定块的指定内容是否为"脏"状态
     */
    isDirty: state => (blockId, contentType) => {
      const dirtySet = state.dirtyBlocks.get(blockId);
      return dirtySet ? dirtySet.has(contentType) : false;
    },

    /**
     * 获取所有"脏"块的信息
     */
    getAllDirtyBlocks: state => {
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
    patchContent(blockId, updates) {
      Object.assign(this.getContent(blockId), updates);
    },
    /**
     * 初始化块的内容状态
     */
    initContent(blockId) {
      if (!this.contents[blockId]) {
        this.contents[blockId] = createContentState();
      }
    },

    /**
     * 清理块状态（组件卸载时调用）
     * 注意：只清理"脏"标记，保留已加载的内容数据，以便页面切换后快速恢复
     */
    cleanupBlock(blockId) {
      // 只清理脏标记，保留内容数据
      this.dirtyBlocks.delete(blockId);
      console.log(
        `[AudioContentStore] Cleaned up dirty flags for block: ${blockId}, content retained`
      );
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
