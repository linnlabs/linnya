// apps/renderer/shared/extensions/marks/TextHighlight.js
// 行内文字高亮 Mark 扩展
// 作用：为选中的文字应用高亮背景（荧光笔效果），不影响文字颜色

import { Mark } from '@tiptap/core'

/**
 * TextHighlightMark
 *
 * 设计说明（重要）：
 * - 这是一个行内 Mark，用于给「部分文字」添加高亮背景
 * - 颜色值使用与块级颜色相同的枚举键，例如：red_text / blue_text ...
 * - 实际背景色从 CSS 变量中读取：var(--block-text-red) 等，通过 color-mix 降低透明度得到浅色底
 * - 只控制背景色，不影响前景色（文字颜色）
 * - 与 textColor mark 共存：可以既有高亮背景，又有不同的文字颜色
 */
export const TextHighlightMark = Mark.create({
  name: 'textHighlight',

  // 允许与其他行内 mark（bold / italic / link / textColor 等）共存
  inclusive: true,

  addAttributes() {
    return {
      /**
       * 颜色枚举值
       * 示例：'red_text' | 'blue_text' | ...
       * 具体含义由 domains/editor/styles/tokens/block-colors.css 中的
       * --block-text-* 变量决定
       * 
       * 背景色通过 color-mix 降低饱和度和亮度，实现"荧光笔"视觉效果
       */
      color: {
        default: null,
        // 从 DOM 中解析：读取 data-text-highlight
        parseHTML: (element) => {
          const raw = element.getAttribute('data-text-highlight')
          return raw || null
        },
        // 渲染到 DOM：写入 data-text-highlight，并拼出对应的 CSS 变量
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {}
          }

          // 约定：属性值类似 'red_text'（低饱和度）或 'bright_yellow'（高亮）
          const raw = String(attributes.color)
          let cssVarName
          let mixRatio = '20%' // 默认混合比例（与面板保持一致：20% 颜色 + 80% 透明）

          if (raw.startsWith('bright_')) {
            // 高亮色：使用 --highlight-bright-* 变量
            const colorName = raw.slice('bright_'.length)
            cssVarName = `--highlight-bright-${colorName}`
            // 整体提升高亮色的混合比例，实现高饱和度荧光效果
            // 黄色特判：为了达到 Word 荧光黄效果，给予更高的不透明度 (60%)
            // 其他亮色：50%
            mixRatio = colorName === 'yellow' ? '60%' : '50%'
          } else if (raw.endsWith('_text')) {
            // 低饱和度文字色：去掉 '_text' 后缀
            const colorKey = raw.slice(0, -'_text'.length)
            cssVarName = `--block-text-${colorKey}`
            mixRatio = '20%' // 混合 20% 颜色 + 80% 透明
          } else {
            // 备用情况
            cssVarName = `--block-text-${raw}`
            mixRatio = '20%'
          }

          // 使用 color-mix 混合
          const bgColor = `color-mix(in srgb, var(${cssVarName}) ${mixRatio}, transparent)`

          return {
            'data-text-highlight': raw,
            style: `background-color: ${bgColor};`,
          }
        },
      },
    }
  },

  /**
   * HTML 解析规则：
   * - 我们只关心带有 data-text-highlight 的 span
   * - 这样可以与普通 span、data-text-color span 区分开
   */
  parseHTML() {
    return [
      {
        tag: 'span[data-text-highlight]',
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
   * 命令：设置 / 清除文字高亮
   *
   * 使用方式（示例）：
   * - 设置高亮：editor.commands.setTextHighlight('yellow_text')
   * - 清除高亮：editor.commands.setTextHighlight(null) 或 editor.commands.unsetTextHighlight()
   */
  addCommands() {
    return {
      /**
       * 设置文字高亮
       * @param {string | null} color 颜色枚举键，例如 'yellow_text'；传 null 表示清除高亮
       */
      setTextHighlight:
        (color) =>
        ({ commands }) => {
          // 传入 null / undefined / 空字符串时，等价于清除高亮
          if (!color) {
            return commands.unsetMark(this.name)
          }

          return commands.setMark(this.name, { color })
        },

      /**
       * 清除文字高亮
       */
      unsetTextHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },
})

export default TextHighlightMark
