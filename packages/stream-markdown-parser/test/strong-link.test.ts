import { describe, expect, it } from 'vitest'
import { getMarkdown, parseMarkdownToStructure } from '../src'

describe('strong containing link edge-case', () => {
  it('parses **[百度](https://baidu.com/)** as strong -> link -> text', () => {
    const md = getMarkdown()
    const label = '\u767E\u5EA6'
    const markdown = `**[${label}](https://baidu.com/)*`

    const nodes = parseMarkdownToStructure(markdown, md)
    // top-level should be a paragraph
    const para = nodes[0] as any
    expect(para.type).toBe('paragraph')

    const strong = para.children?.[0]
    expect(strong).toBeDefined()
    expect(strong.type).toBe('strong')

    const link = strong.children?.[0]
    expect(link).toBeDefined()
    expect(link.type).toBe('link')
    // markdown-it may normalize or ensure trailing slash; accept main host
    expect(link.href).toMatch(/https:\/\/baidu\.com\/?/)

    const text = link.children?.[0]
    expect(text).toBeDefined()
    expect(text.type).toBe('text')
    expect(text.content).toBe(label)
  })

  it('parses **[DR **(Danmarks Radio)](https://baidu.com/)** as strong -> link -> text', () => {
    const md = getMarkdown()
    const label = 'DR **(Danmarks Radio)'
    const markdown = `**[${label}](https://baidu.com/)*`

    const nodes = parseMarkdownToStructure(markdown, md)
    // top-level should be a paragraph
    const para = nodes[0] as any
    expect(para.type).toBe('paragraph')

    const strong = para.children?.[0]
    expect(strong).toBeDefined()
    expect(strong.type).toBe('strong')

    const link = strong.children?.[0]
    expect(link).toBeDefined()
    expect(link.type).toBe('link')
    // markdown-it may normalize or ensure trailing slash; accept main host
    expect(link.href).toMatch(/https:\/\/baidu\.com\/?/)

    const text = link.children?.[0]
    const strongText = link.children?.[1]
    expect(strongText).toBeDefined()
    expect(strongText.type).toBe('strong')
    expect(strongText.children?.[0].content).toBe('(Danmarks Radio)')
    expect(text).toBeDefined()
    expect(text.type).toBe('text')
    expect(text.content).toBe('DR ')
  })

  it('parses **[DR (Danmarks Radio)**](https://baidu.com/)** as strong -> link -> text', () => {
    const md = getMarkdown()
    const label = 'DR (Danmarks Radio)**'
    const markdown = `**[${label}](https://baidu.com/)*`

    const nodes = parseMarkdownToStructure(markdown, md)
    // top-level should be a paragraph
    const para = nodes[0] as any
    expect(para.type).toBe('paragraph')

    const strong = para.children?.[0]
    expect(strong).toBeDefined()
    expect(strong.type).toBe('strong')

    const link = strong.children?.[0]
    expect(link).toBeDefined()
    expect(link.type).toBe('link')
    // markdown-it may normalize or ensure trailing slash; accept main host
    expect(link.href).toMatch(/https:\/\/baidu\.com\/?/)

    const text = link.children?.[0]
    expect(text).toBeDefined()
    expect(text.type).toBe('text')
    expect(text.content).toBe(label.slice(0, -2))
  })

  it('parses **[**(Danmarks Radio)**](https://baidu.com/)** as strong -> link -> text', () => {
    const md = getMarkdown()
    const label = '**(Danmarks Radio)**'
    const markdown = `**[${label}](https://baidu.com/)*`

    const nodes = parseMarkdownToStructure(markdown, md)
    // top-level should be a paragraph
    const para = nodes[0] as any
    expect(para.type).toBe('paragraph')

    const strong = para.children?.[0]
    expect(strong).toBeDefined()
    expect(strong.type).toBe('strong')

    const link = strong.children?.[0]
    expect(link).toBeDefined()
    expect(link.type).toBe('link')
    // markdown-it may normalize or ensure trailing slash; accept main host
    expect(link.href).toMatch(/https:\/\/baidu\.com\/?/)

    const text = link.children?.[0]
    expect(text).toBeDefined()
    expect(text.type).toBe('strong')
    expect(text.children?.[0].content).toBe(label.slice(2, -2))
  })
})
