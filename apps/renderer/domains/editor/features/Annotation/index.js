// src/renderer/extensions/annotation/index.js
/**
 * 批注功能模块导出文件
 */

export { default as useAnnotationStore } from './useAnnotationStore';
export { useAnnotationLayoutManager } from './position/AnnoLayoutManager';
export { setupBlockEventHandler } from './BlockEventHandler';

// --- Tiptap 扩展 ---
export { default as AnnotationKeyboardExtension } from './extensions/AnnoKeyboardExtension';
export { default as AnnoLayoutPlugin } from './AnnoLayoutPlugin';


// 导出命令
export * from './commands'; 