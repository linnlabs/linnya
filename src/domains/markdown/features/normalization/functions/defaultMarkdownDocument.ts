/**
 * @file defaultMarkdownDocument.ts
 * @description Workspace Markdown 新建链路的空文档结构构建器（纯函数）
 *
 * 目标：
 * - 为 write_file 与 Workspace Markdown 基础设施提供统一空文档结构
 * - 不依赖 DB/Service，便于复用与单测
 */

import { generateEditorBlockId, generateEditorRootBlockId } from 'src/shared/utils/idUtils';

/**
 * 默认空文档结构。
 */
export function getDefaultContent(): Record<string, unknown> {
  // Workspace 块级编辑、pending revision 和 DocumentView 共同使用
  // rootBlock.attrs.id；身份必须在文档实体创建时一次性分配。
  const rootId = generateEditorRootBlockId();
  const baseId = generateEditorBlockId();

  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: {
          id: rootId
        },
        content: [
          {
            type: 'baseBlock',
            attrs: {
              id: baseId,
              blockType: 'base'
            },
            content: []
          }
        ]
      }
    ]
  };
}
