// @vitest-environment jsdom

import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Editor } from '@tiptap/vue-3'
import { afterEach, describe, expect, it } from 'vitest'

import LinkMark from './Link'

describe('LinkMark', () => {
  let editor: Editor | null = null

  afterEach(() => {
    editor?.destroy()
    editor = null
  })

  it('在 JSON、HTML 与命令之间保留 href/title 合同', () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, LinkMark],
      content: '<p><a href="https://example.com" title="示例">链接</a></p>',
    })

    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]).toEqual({
      type: 'link',
      attrs: {
        href: 'https://example.com',
        title: '示例',
      },
    })

    editor.commands.selectAll()
    expect(editor.commands.setLink({ href: 'https://example.com/new', title: null })).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs).toEqual({
      href: 'https://example.com/new',
      title: null,
    })

    const rendered = new DOMParser().parseFromString(editor.getHTML(), 'text/html')
    expect(rendered.querySelector('a')?.getAttribute('href')).toBe('https://example.com/new')
  })
})
