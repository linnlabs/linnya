// src/renderer/app/core/extensions/index.js
/**
 * 核心 Tiptap 扩展导出文件
 * 
 * 这个文件作为所有应用核心层自定义 Tiptap 扩展的统一出口，
 * 方便在 EditorContext.vue 中统一导入和注册。
 */

import { CoreCommandsExtension } from './CoreCommandsExtension';
import { UniqueIdsExtension } from './UniqueIdsExtension'; // 假设已重命名
import { SchemaProviderExtension } from './SchemaProviderExtension';
import { BlockLifecycleExtension } from './BlockLifecycleExtension';

// --- 如果有其他核心扩展，也在这里导入并导出 ---
// import { AnotherCoreExtension } from './AnotherCoreExtension';

const coreExtensions = [
  CoreCommandsExtension,
  UniqueIdsExtension,
  SchemaProviderExtension,
  BlockLifecycleExtension,
  // AnotherCoreExtension, // 如果有其他
];

export {
  CoreCommandsExtension,
  UniqueIdsExtension,
  SchemaProviderExtension,
  BlockLifecycleExtension,
  // AnotherCoreExtension, // 如果有其他
};

// 默认导出一个包含所有核心扩展的数组，方便直接在 Tiptap editorconfig 中使用
export default coreExtensions; 