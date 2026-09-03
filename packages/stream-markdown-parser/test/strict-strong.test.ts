import { describe, expect, it } from 'vitest'
import { parseInlineTokens } from '../src'

describe('parseInlineTokens strict strong matching', () => {
  it('default (non-strict) treats unclosed ** as mid-state strong', () => {
    const raw = '[**cxx](xxx)'
    const tokens: any[] = [{ type: 'text', content: raw }]
    const nodes = parseInlineTokens(tokens, raw)
    expect(nodes.length).toBeGreaterThan(0)
    // Expect the parser will create a strong node in non-strict mode
    const first = nodes[0] as any
    expect(first).toBeDefined()
    expect(first.type).toBe('strong')
    expect(first.children?.[0]?.type).toBe('link')
    expect(first.children?.[0]?.text).toContain('cxx')
  })

  it('strict mode keeps original text when no closing ** is found', () => {
    const raw = '[**cxx](xxx)'
    const tokens: any[] = [{ type: 'text', content: raw }]
    const nodes = parseInlineTokens(tokens, raw, undefined, { requireClosingStrong: true })
    expect(nodes.length).toBeGreaterThan(0)
    const first = nodes[0] as any
    expect(first.type).toBe('link')
    expect(first.children[0].content).toBe(raw.match(/\[([^\]]+)\]/)?.[1])
  })
})
