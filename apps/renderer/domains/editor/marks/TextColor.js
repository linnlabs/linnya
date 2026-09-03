// apps/renderer/shared/extensions/marks/TextColor.js
// 行内文字颜色 Mark 扩展
// 作用：为选中的文字应用颜色，不影响块级颜色（RootBlock 的 textColor）

import { Mark } from '@tiptap/core'

/**
 * TextColorMark
 *
 * 设计说明（重要）：
 * - 这是一个行内 Mark，用于给「部分文字」着色
 * - 颜色值使用与块级颜色相同的枚举键，例如：red_text / blue_text ...
 * - 实际颜色从 CSS 变量中读取：var(--block-text-red) 等
 * - 优先级：行内颜色 Mark > 块级 textColor > 默认文本颜色
 */
export const TextColorMark = Mark.create({
  name: 'textColor',

  // 提高优先级，确保在 DOM 结构中包裹 Strike 等其他 mark
  // 这样 Strike（删除线）可以继承 TextColor 的颜色
  priority: 1001,

  // 允许与其他行内 mark（bold / italic / link 等）共存
  inclusive: true,

  addAttributes() {
    return {
      /**
       * 颜色枚举值
       * 示例：'red_text' | 'blue_text' | ...
       * 具体含义由 domains/editor/styles/tokens/block-colors.css 中的
       * --block-text-* 变量决定
       */
      color: {
        default: null,
        // 从 DOM 中解析：优先读取 data-text-color
        parseHTML: (element) => {
          const raw = element.getAttribute('data-text-color')
          return raw || null
        },
        // 渲染到 DOM：写入 data-text-color，并拼出对应的 CSS 变量
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {}
          }

          // 约定：属性值类似 'red_text'，需要去掉后缀 '_text'
          const raw = String(attributes.color)
          const colorKey = raw.endsWith('_text')
            ? raw.slice(0, -'_text'.length)
            : raw

          const cssVarName = `--block-text-${colorKey}`

          return {
            'data-text-color': raw,
            style: `color: var(${cssVarName})`,
          }
        },
      },
    }
  },

  /**
   * HTML 解析规则：
   * - 我们只关心带有 data-text-color 的 span
   * - 这样可以与普通 span 区分开
   */
  parseHTML() {
    return [
      {
        tag: 'span[data-text-color]',
      },
    ]
  },

  /**
   * HTML 渲染规则：
   * - 保持简单：渲染为 <span ...>...</span>
   * - 具体的 style / data- 属性由 renderHTML(attributes) 决定
   */
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },

  /**
   * 命令：设置 / 清除文字颜色
   *
   * 使用方式（示例）：
   * - 设置颜色：editor.commands.setTextColor('red_text')
   * - 清除颜色：editor.commands.setTextColor(null) 或 editor.commands.unsetTextColor()
   */
  addCommands() {
    return {
      /**
       * 设置文字颜色
       * @param {string | null} color 颜色枚举键，例如 'red_text'；传 null 表示清除颜色
       */
      setTextColor:
        (color) =>
        ({ commands }) => {
          // 传入 null / undefined / 空字符串时，等价于清除颜色
          if (!color) {
            return commands.unsetMark(this.name)
          }

          return commands.setMark(this.name, { color })
        },

      /**
       * 清除文字颜色
       */
      unsetTextColor:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },
})

export default TextColorMark

