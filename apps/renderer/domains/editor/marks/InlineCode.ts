/**
 * @file InlineCode.ts
 * @description 自定义行内 code Mark：
 * - 允许与 `revisionMark` 共存（修订标记必须能覆盖在代码样式上）
 * - 仍然排斥其它语义 marks（bold/italic/strike/...），避免出现“代码里加粗”等不符合预期的组合
 *
 * 根因说明（中文）：
 * - Tiptap/ProseMirror 默认的 `code` mark 通常会 `excludes: '_'`（排斥所有其它 marks）
 * - 当我们给“代码片段”同时加上 `revisionMark` 时，会触发 ProseMirror 校验：
 *   RangeError: Invalid collection of marks for node text: code,revisionMark
 * - 因此需要一个“仅放行 revisionMark”的 code mark。
 */

import { Mark } from '@tiptap/core'

export const InlineCodeMark = Mark.create({
  name: 'code',

  /**
   * 关键：排斥常见格式 mark，但不排斥 revisionMark。
   *
   * 注意：
   * - 这里使用显式列表而非 '_'，否则会把 revisionMark 也排斥掉。
   * - 如果未来新增更多 marks（例如 link/underline），可按需补充到 excludes。
   */
  excludes: 'bold italic strike textColor textHighlight',

  // 告诉 ProseMirror：这是 code mark（会影响输入规则/排版行为）
  code: true,

  inclusive: false,

  parseHTML() {
    return [{ tag: 'code' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['code', HTMLAttributes, 0]
  },
})

export default InlineCodeMark


