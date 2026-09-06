import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * Workspace Markdown 正式 `link` mark 的 Editor 实现。
 *
 * `href/title` 与 Markdown domain 的持久化合同一致；Markdown 输入规则、HTML
 * 解析/渲染和命令共用这一实现，避免再次出现“调用 setLink 但 schema 未注册”的断链。
 * Tiptap 3 已为 link 命令提供公共类型声明；本扩展只替换运行时 mark，不重复声明
 * 同名命令，避免与上游属性合同产生冲突。
 */
export const LinkMark = Mark.create({
  name: 'link',

  inclusive: false,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('href') ?? '',
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[href]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setLink:
        attributes =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      toggleLink:
        attributes =>
        ({ commands }) =>
          commands.toggleMark(this.name, attributes),
      unsetLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

export default LinkMark
