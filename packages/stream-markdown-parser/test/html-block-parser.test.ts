import { describe, expect, it } from 'vitest'
import { getMarkdown, parseMarkdownToStructure } from '../src'

function firstHtml(nodes: any[]) {
  return nodes.find(n => n.type === 'html_block')
}

describe('html_block parser', () => {
  it('marks unclosed <div> as loading and appends closing tag', () => {
    const md = getMarkdown()
    const nodes = parseMarkdownToStructure('<div>hello', md)
    const html = firstHtml(nodes) as any
    expect(html).toBeDefined()
    expect(html.type).toBe('html_block')
    expect(html.tag).toBe('div')
    expect(html.loading).toBe(true)
    expect(html.content).toContain('</div>')
  })

  it('handles uppercase closing tag case-insensitively', () => {
    const md = getMarkdown()
    const nodes = parseMarkdownToStructure('<DIV>Hi</DIV>', md)
    const html = firstHtml(nodes) as any
    expect(html.loading).toBe(false)
    expect(html.tag).toBe('div')
  })

  it('treats void tags as closed (no loading, no fake close)', () => {
    const md = getMarkdown()
    const nodes = parseMarkdownToStructure('<br>', md)
    const html = firstHtml(nodes) as any
    expect(html.loading).toBe(false)
    expect(String(html.content)).not.toContain('</br>')
  })

  it('treats self-closing first tag as closed', () => {
    const md = getMarkdown()
    const nodes = parseMarkdownToStructure('<img src="/x.png" />', md)
    const html = firstHtml(nodes) as any
    expect(html.loading).toBe(false)
    expect(String(html.content)).toContain('<img')
    expect(String(html.content)).not.toContain('</img>')
  })

  it('does not attempt to close comments/doctypes/PIs', () => {
    const md = getMarkdown()
    const a = firstHtml(parseMarkdownToStructure('<!-- comment -->', md)) as any
    const b = firstHtml(parseMarkdownToStructure('<!DOCTYPE html>', md)) as any
    const c = firstHtml(parseMarkdownToStructure('<?xml version="1.0"?>', md)) as any
    expect(a?.loading).toBe(false)
    expect(b?.loading).toBe(false)
    expect(c?.loading).toBe(false)
  })
})
