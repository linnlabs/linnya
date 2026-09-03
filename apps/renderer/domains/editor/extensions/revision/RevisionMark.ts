/**
 * @file RevisionMark.ts
 * @description AI 修订模式的行内 Mark 扩展
 *
 * 用于标记 AI 修订产生的文本差异：
 * - insert: 新增的文字（绿色背景 + 下划线）
 * - delete: 删除的文字（红色背景 + 删除线）
 *
 * 设计原则：
 * - 与现有的 textColor / textHighlight mark 共存
 * - 支持逐条接受/拒绝操作
 * - 持久化到文档 JSON 中，支持跨会话保留未决修订
 */

import { Mark, mergeAttributes } from '@tiptap/core'

/** 修订变更类型 */
export type RevisionChangeType = 'insert' | 'delete'

/** 修订来源 */
export type RevisionSource = 'ai' | 'user'

/** RevisionMark 属性接口 */
export interface RevisionMarkAttrs {
  /** 本次修订会话 ID（用于批量接受/拒绝同一次修订的所有变更） */
  revisionId: string
  /** 变更类型：insert 表示新增，delete 表示删除 */
  changeType: RevisionChangeType
  /** 修订来源：ai 表示 AI 生成，user 表示用户手动 */
  source: RevisionSource
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    revisionMark: {
      /**
       * 设置修订标记
       * @param attrs - 修订属性
       */
      setRevisionMark: (attrs: Partial<RevisionMarkAttrs>) => ReturnType
      /**
       * 清除修订标记
       */
      unsetRevisionMark: () => ReturnType
      /**
       * 切换修订标记
       * @param attrs - 修订属性
       */
      toggleRevisionMark: (attrs: Partial<RevisionMarkAttrs>) => ReturnType
    }
  }
}

/**
 * RevisionMark 扩展
 *
 * 样式约定：
 * - insert: 使用 --color-success-bg 作为背景，--color-success 作为文字颜色，带下划线
 * - delete: 使用 --color-error-bg 作为背景，--color-error 作为文字颜色，带删除线
 * 
 * 样式定义在 domains/editor/styles/components/RevisionMark.css 中，使用项目颜色变量。
 */
export const RevisionMark = Mark.create({
  name: 'revisionMark',

  // 允许与其他行内 mark 共存（bold / italic / textColor 等）
  inclusive: false,

  // 不允许跨块合并
  spanning: false,

  addAttributes() {
    return {
      revisionId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-revision-id'),
        renderHTML: (attributes: RevisionMarkAttrs) => {
          if (!attributes.revisionId) return {}
          return { 'data-revision-id': attributes.revisionId }
        },
      },
      changeType: {
        default: 'insert',
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute('data-change-type') as RevisionChangeType) || 'insert',
        renderHTML: (attributes: RevisionMarkAttrs) => {
          return { 'data-change-type': attributes.changeType }
        },
      },
      source: {
        default: 'ai',
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute('data-revision-source') as RevisionSource) || 'ai',
        renderHTML: (attributes: RevisionMarkAttrs) => {
          return { 'data-revision-source': attributes.source }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-revision-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const changeType = HTMLAttributes['data-change-type'] as RevisionChangeType

    // 移除内联样式，改用 CSS 类，样式由 RevisionMark.css 中的 CSS 变量控制
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: `revision-mark revision-mark--${changeType}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      /**
       * 设置修订标记
       * @param attrs - 修订属性
       */
      setRevisionMark:
        (attrs: Partial<RevisionMarkAttrs>) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs)
        },

      /**
       * 清除修订标记
       */
      unsetRevisionMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },

      /**
       * 切换修订标记
       * @param attrs - 修订属性
       */
      toggleRevisionMark:
        (attrs: Partial<RevisionMarkAttrs>) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attrs)
        },
    }
  },
})

export default RevisionMark
