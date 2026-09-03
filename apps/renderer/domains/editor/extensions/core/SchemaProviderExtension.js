/**
 * SchemaProviderExtension.js
 *
 * 这个 Tiptap 扩展负责将应用核心的 Schema 信息（如根块名称、内容块判断逻辑）
 * 通过 editor.storage 提供给 shared 层或其他可能需要这些信息的模块，
 * 以此避免 shared 层直接依赖 app/core/schema.js。
 */
import { Extension } from '@tiptap/core';
import { NODE_GROUPS } from './schema'; // 从 app/core/schema.js 导入
import {
  SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY,
  SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY,
} from '../../shared/constants/editorStorageKeys'; // 导入共享键

export const SchemaProviderExtension = Extension.create({
  name: 'schemaProvider',

  onCreate() {
    if (!this.editor) {
      console.error('[SchemaProviderExtension] 未找到编辑器实例。');
      return;
    }

    // 1. 提供根块节点的类型名称
    // 假设 NODE_GROUPS.BLOCK_CONTAINER 存储的是单个根块的名称，例如 'rootBlock'
    if (typeof NODE_GROUPS.BLOCK_CONTAINER === 'string') {
      this.editor.storage[SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY] = NODE_GROUPS.BLOCK_CONTAINER;
    } else {
      console.warn(
        '[SchemaProviderExtension] NODE_GROUPS.BLOCK_CONTAINER 不是预期的字符串格式。请检查 app/core/schema.js。'
      );
      // 提供一个默认的回退值，以防万一
      this.editor.storage[SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY] = 'rootBlock';
    }

    // 2. 提供一个判断节点是否为"块内容"的谓词函数
    const blockContentNodeNames = NODE_GROUPS.BLOCK_CONTENT
      ? NODE_GROUPS.BLOCK_CONTENT.split('|').filter(name => name.trim() !== '')
      : [];

    if (blockContentNodeNames.length === 0) {
      console.warn(
        '[SchemaProviderExtension] NODE_GROUPS.BLOCK_CONTENT 未定义或为空。请检查 app/core/schema.js。'
      );
    }

    const isBlockContentNode = (nodeTypeName) => {
      if (typeof nodeTypeName !== 'string') return false;
      return blockContentNodeNames.includes(nodeTypeName);
    };

    this.editor.storage[SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY] = isBlockContentNode;

    // 可选：添加一个日志，确认信息已设置（仅在开发模式下）
    if (import.meta.env.DEV) {
      console.log(
        '[SchemaProviderExtension] 已将 Schema 信息注册到 editor.storage:',
        {
          rootBlockTypeName: this.editor.storage[SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY],
          isBlockContentPredicateProvided: typeof this.editor.storage[SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY] === 'function',
        }
      );
    }
  },

  // 通常，这种提供配置的扩展不需要其他 Tiptap 功能，
  // 但如果需要，可以在这里添加 addCommands, addInputRules 等。
});

export default SchemaProviderExtension; 