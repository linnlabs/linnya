/**
 * @file audioEditors.store.js
 * @description AudioBlock 子编辑器实例注册表
 * 
 * 职责：
 * - 管理每个 AudioBlock 的子编辑器实例（notes/transcript/summary）
 * - 提供查找替换等横切功能所需的编辑器遍历能力
 */

import { defineStore } from 'pinia';

/**
 * 编辑器注册表结构：
 * {
 *   'block-abc': {
 *     notes: Editor实例,
 *     transcript: Editor实例,
 *     summary: Editor实例
 *   }
 * }
 */
export const useAudioEditorsStore = defineStore('audioEditors', {
  state: () => ({
    /** @type {Record<string, Record<string, any>>} */
    editorRegistry: {},
  }),

  getters: {
    /**
     * 获取指定 AudioBlock 的所有编辑器实例
     */
    getEditors: (state) => (blockId) => {
      return state.editorRegistry[blockId] || {};
    },

    /**
     * 获取指定 AudioBlock 的特定类型编辑器
     */
    getEditor: (state) => (blockId, editorType) => {
      return state.editorRegistry[blockId]?.[editorType] || null;
    },

    /**
     * 获取所有已注册的编辑器实例（扁平化）
     * 用于查找替换等全局操作
     */
    getAllEditors: (state) => {
      const editors = [];
      for (const blockId in state.editorRegistry) {
        for (const editorType in state.editorRegistry[blockId]) {
          const editor = state.editorRegistry[blockId][editorType];
          if (editor) {
            editors.push({
              blockId,
              editorType,
              editor,
            });
          }
        }
      }
      return editors;
    },
  },

  actions: {
    /**
     * 注册编辑器实例
     * @param {string} blockId - AudioBlock ID
     * @param {string} editorType - 编辑器类型（notes/transcript/summary）
     * @param {any} editor - Tiptap Editor 实例
     */
    registerEditor(blockId, editorType, editor) {
      if (!this.editorRegistry[blockId]) {
        this.editorRegistry[blockId] = {};
      }
      this.editorRegistry[blockId][editorType] = editor;
      console.log(`[AudioEditorsStore] 注册编辑器: ${blockId}/${editorType}`);
    },

    /**
     * 注销编辑器实例
     * @param {string} blockId - AudioBlock ID
     * @param {string} editorType - 编辑器类型
     */
    unregisterEditor(blockId, editorType) {
      if (this.editorRegistry[blockId]) {
        delete this.editorRegistry[blockId][editorType];
        console.log(`[AudioEditorsStore] 注销编辑器: ${blockId}/${editorType}`);
        
        // 如果该 block 的所有编辑器都已注销，清理整个 block 记录
        if (Object.keys(this.editorRegistry[blockId]).length === 0) {
          delete this.editorRegistry[blockId];
          console.log(`[AudioEditorsStore] 清理 block 记录: ${blockId}`);
        }
      }
    },

    /**
     * 清理指定 AudioBlock 的所有编辑器
     * @param {string} blockId - AudioBlock ID
     */
    cleanupBlock(blockId) {
      if (this.editorRegistry[blockId]) {
        delete this.editorRegistry[blockId];
        console.log(`[AudioEditorsStore] 清理 block 所有编辑器: ${blockId}`);
      }
    },
  },
});

