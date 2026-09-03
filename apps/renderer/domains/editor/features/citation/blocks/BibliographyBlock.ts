/**
 * @file citation/blocks/BibliographyBlock.ts
 * @description 参考文献容器块（Node）扩展
 *
 * BibliographyBlock 是一个特殊的内容块，用于在文末展示参考文献列表。
 * 它是"系统块（System Block）"，具有以下特性：
 * - 文档中最多只能有一个
 * - 必须位于文末
 * - 不支持 BlockHistory（历史版本）
 * - 由系统自动创建/删除，用户不能直接删除
 *
 * Phase 1 职责：
 * - 定义 attrs schema（styleId）
 * - 提供最小 renderHTML（保证持久化闭环）
 *
 * Phase 3 职责：
 * - 通过 VueNodeViewRenderer 渲染真实的参考文献列表
 */

import { Node } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { generateBlockId } from '../../../../../shared/utils/idUtils'
import { NODE_GROUPS } from '../../../extensions/core/schema'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import type { BibliographyStyleId } from '../types'
import CitationBibliographyView from '../ui/components/CitationBibliographyView.vue'

/**
 * Tiptap 命令类型扩展（非常重要）
 *
 * 中文说明：
 * - Tiptap 的 `addCommands()` 返回值必须是 `Partial<RawCommands>`
 * - 如果不做 module augmentation，TS 不知道我们新增了 `setBibliographyStyle`，就会报：
 *   “has no properties in common with type Partial<RawCommands>”
 * - 这里声明自定义命令，保证类型系统能识别
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bibliography: {
      /** 设置参考文献样式（更新 bibliographyBlock 的 attrs.styleId） */
      setBibliographyStyle: (styleId: BibliographyStyleId) => ReturnType
    }
  }
}

/**
 * BibliographyBlock 扩展
 *
 * 设计说明：
 * - 这是一个块级 Node，作为参考文献的容器
 * - 内容为空（Phase 1），后续 Phase 会通过 NodeView 渲染条目列表
 * - 被标记为"系统块"，不允许用户直接编辑/删除
 */
export const BibliographyBlock = Node.create({
  name: 'bibliographyBlock',

  // 加入 block 组和 BLOCK_CONTENT 组，允许作为 RootBlock 的子节点
  group: `block ${NODE_GROUPS.BLOCK_CONTENT}`,

  // Phase 1: 内容为空，后续 Phase 会改为通过 NodeView 渲染
  content: '',

  // 块特性
  defining: true,
  selectable: true,
  draggable: false,

  // 优先级设置为较低，避免与 BaseBlock 冲突
  priority: 50,

  // 原子块：内容由系统管理，用户不能直接编辑
  atom: true,

  addAttributes() {
    return {
      /**
       * 块 ID（与其他 contentBlock 一致）
       */
      id: {
        default: () => generateBlockId(),
        parseHTML: (element: HTMLElement) => {
          return element.getAttribute('data-block-id') || generateBlockId()
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          return {
            'data-block-id': attributes.id as string,
          }
        },
      },

      /**
       * 块类型标识
       */
      blockType: {
        default: 'bibliography',
        parseHTML: () => 'bibliography',
        renderHTML: () => {
          return {
            'data-block-type': 'bibliography',
          }
        },
      },

      /**
       * 参考文献样式
       * - numeric: 数字编号（如 [1], [2]）
       * - author-date: 作者-年份（如 (Smith, 2024)）
       */
      styleId: {
        default: 'numeric' as BibliographyStyleId,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-style-id')
          if (value === 'numeric' || value === 'author-date') {
            return value
          }
          return 'numeric'
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          return {
            'data-style-id': attributes.styleId as string,
          }
        },
      },
    }
  },

  /**
   * HTML 解析规则
   */
  parseHTML() {
    return [
      {
        tag: 'div[data-block-type="bibliography"]',
      },
    ]
  },

  /**
   * HTML 渲染规则
   * 用于序列化/导出时的 HTML 输出
   * 实际编辑器内渲染由 NodeView 负责
   */
  renderHTML({ node }) {
    // 创建外层容器
    const outer = document.createElement('div')
    // 中文说明：复用 BaseBlock 的 outer 结构，让系统块的外观/间距更接近正文块
    outer.className = 'bibliography-block-outer base-block-outer'
    outer.setAttribute('data-node-type', 'bibliographyBlockOuter')

    // 创建内层容器
    const inner = document.createElement('div')
    // 中文说明：复用 BaseBlock 的 inner 结构（排版/line-height 等），bibliography 仅保留内部排版细节
    inner.className = 'bibliography-block base-block editor-block'
    inner.setAttribute('data-node-type', 'bibliographyBlock')
    inner.setAttribute('data-block-type', 'bibliography')
    inner.setAttribute('data-block-id', node.attrs.id as string)
    inner.setAttribute('data-style-id', node.attrs.styleId as string)

    // 序列化时的占位内容（实际渲染由 NodeView 负责）
    const placeholder = document.createElement('div')
    placeholder.className = 'bibliography-placeholder'
    placeholder.textContent = resolveCurrentEditorMessage('editor.citation.bibliography.title')

    inner.appendChild(placeholder)
    outer.appendChild(inner)

    return {
      dom: outer,
    }
  },

  /**
   * NodeView 渲染
   * Phase 3: 使用 Vue 组件渲染真实的参考文献列表
   */
  addNodeView() {
    return VueNodeViewRenderer(CitationBibliographyView)
  },

  /**
   * 命令集
   */
  addCommands() {
    return {
      /**
       * 设置参考文献样式
       * @param styleId - 样式 ID
       */
      setBibliographyStyle:
        (styleId: BibliographyStyleId) =>
        ({ commands }: CommandProps) => {
          return commands.updateAttributes(this.name, { styleId })
        },
    }
  },
})

export default BibliographyBlock
