import { Mark, mergeAttributes } from '@tiptap/core'

export interface EditorLinkAttributes {
  href: string
  title: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    link: {
      setLink: (attributes: Partial<EditorLinkAttributes>) => ReturnType
      toggleLink: (attributes: Partial<EditorLinkAttributes>) => ReturnType
      unsetLink: () => ReturnType
    }
  }
}

/**
 * Workspace Markdown 正式 `link` mark 的 Editor 实现。
 *
 * `href/title` 与 Markdown domain 的持久化合同一致；Markdown 输入规则、HTML
 * 解析/渲染和命令共用这一实现，避免再次出现“调用 setLink 但 schema 未注册”的断链。
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
