/**
 * @file markdownPlaceholder.ts
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

/**
 * 构造一个「原始 Markdown 占位」文档结构。
 *
 * 约定：
 * - 将原始 Markdown 文本存入 baseBlock.attrs.rawMarkdownSource
 * - 由前端在文档首次打开时检测到该属性后，调用 WASM 解析器将其转换为完整块结构，
 *   并通过 workspace:save-document 回写到数据库。
 */
export function buildRawMarkdownPlaceholder(text: string): Record<string, unknown> {
  // 为占位文档分配稳定的块 ID，且与前端 Editor 的 ID 生成规则保持一致：
  // - 前端使用 generateRootBlockId() / generateBlockId() 生成形如 "root-xxxxxxxx" / "block-xxxxxxxx" 的 ID；
  // - 这里沿用同一模式，避免出现一部分块是 UUID、一部分块是前缀短 ID 的混用。
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
              blockType: 'base',
              // 标记这是需要被 Markdown 解析的占位块
              rawMarkdownSource: text
            },
            // 占位内容可以为空，真正展示内容由首开解析后的结构决定
            content: []
          }
        ]
      }
    ]
  };
}
