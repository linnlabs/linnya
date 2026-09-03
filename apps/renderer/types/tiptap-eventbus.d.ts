/**
 * @file tiptap-eventbus.d.ts
 * @description 为 Tiptap Editor 扩展 eventBus 的类型声明（前端专用）
 *
 * 重要：
 * - 必须先 import '@tiptap/core'，确保这是“模块增强（augmentation）”而不是“重新声明模块”
 * - 否则会把 @tiptap/core 的原始类型覆盖掉，导致 Editor 缺失 state/commands/view 等核心字段
 */

import '@tiptap/core';

export {};

declare module '@tiptap/core' {
  interface Editor {
    /**
     * 编辑器事件总线（项目自定义注入）
     * - on/off/emit 的契约与 editorFactory.js 中保持一致
     */
    eventBus?: {
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      off: (event: string, callback: (...args: unknown[]) => void) => void;
      emit: (event: string, ...args: unknown[]) => void;
    };
  }
}


