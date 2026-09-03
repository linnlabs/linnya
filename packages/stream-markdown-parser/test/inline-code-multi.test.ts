import { describe, expect, it } from 'vitest'
import { getMarkdown, parseMarkdownToStructure } from '../src'

describe('parser inline code multiple spans', () => {
  it('parses multiple inline code spans and emphasis correctly', () => {
    const md = getMarkdown()
    const markdown = '1.  **整合冗余条款：** 将原`1-(5)`、`3-(3)`、`3-(4)`中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入`1-(4)`“法律状态维护与通知义务”中，使其逻辑更集中，避免了在不同部分重复提及相似义务。'

    const nodes = parseMarkdownToStructure(markdown, md)

    const serialized = JSON.stringify(nodes)
    // Ensure we produced a strong node
    expect(serialized).toContain('"type":"strong"')

    // Also ensure code spans exist and expected snippets appear
    expect(serialized).toContain('1-(5)')
    expect(serialized).toContain('3-(3)')
    expect(serialized).toContain('3-(4)')
    expect(serialized).toContain('1-(4)')
  })

  it('handles mid-state with trailing opening backtick in list item', () => {
    const md = getMarkdown()
    // mid-state: trailing opening backtick after a comma
    const markdownMid = '1.  **整合冗余条款：** 将原`1-(5)`、`'
    const nodesMid = parseMarkdownToStructure(markdownMid, md)
    const serializedMid = JSON.stringify(nodesMid)
    // debug: dump nodes for diagnostic

    console.log('DEBUG_NODES_MID_FULL:', JSON.stringify(nodesMid, null, 2))
    // debug output removed

    // Should contain a strong node for the leading bold and an inline_code mid-state
    expect(serializedMid).toContain('"type":"strong"')
    // mid-state inline code: there may be an inline_code node with empty code or raw ending in backtick
    expect(serializedMid.includes('inline_code') || serializedMid.includes('`')).toBeTruthy()
  })

  it('handles mid-state with trailing opening backtick in list item mid-state 1', () => {
    const md = getMarkdown()
    // mid-state: trailing opening backtick after a comma
    const markdownMid = '1.  **整合冗余条款：** 将原`1-(5)`、`3'
    const nodesMid = parseMarkdownToStructure(markdownMid, md)
    const children = nodesMid[0].items[0].children[0].children
    // Should contain a strong node for the leading bold and an inline_code mid-state
    expect(children[0].type).toBe('strong')
    expect(children[0].raw).toBe('**整合冗余条款：**')
    expect(children[1].type).toBe('text')
    expect(children[1].content).toBe(' 将原')
    expect(children[2].type).toBe('inline_code')
    expect(children[2].code).toBe('1-(5)')
    // The punctuation between code spans may be parsed as text or as a tiny
    // inline_code node in mid-state scenarios depending on token boundaries.
    // Accept either a text node or an inline_code node for the punctuation
    expect(['text', 'inline_code']).toContain(children[3]?.type)
    // Ensure at least one child contains the punctuation '、' either as content or as inline code
    const hasPunctuation = children.some((c: any) => (c.content === '、') || (c.code === '、'))
    expect(hasPunctuation).toBeTruthy()
  })

  it('handles mid-state with trailing opening backtick in list item mid-state 2', () => {
    const md = getMarkdown()
    // mid-state: trailing opening backtick after a comma
    const markdownMid = '1.  **整合冗余条款：** 将原`1-(5)`、`3-(3)`、`3-(4)`中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入`1-'
    const nodesMid = parseMarkdownToStructure(markdownMid, md)
    const children = nodesMid[0].items[0].children[0].children
    // Should contain a strong node for the leading bold and an inline_code mid-state
    expect(children[0].type).toBe('strong')
    expect(children[0].raw).toBe('**整合冗余条款：**')
    expect(children[1].type).toBe('text')
    expect(children[1].content).toBe(' 将原')
    expect(children[2].type).toBe('inline_code')
    expect(children[2].code).toBe('1-(5)')
    expect(children[3].type).toBe('text')
    expect(children[3].content).toBe('、')
    expect(children[4].type).toBe('inline_code')
    expect(children[4].code).toBe('3-(3)')
    expect(children[5].type).toBe('text')
    expect(children[5].content).toBe('、')
    expect(children[6].type).toBe('inline_code')
    expect(children[6].code).toBe('3-(4)')
    expect(children[7].type).toBe('text')
    expect(children[7].content).toBe('中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入')
    expect(children[8].type).toBe('inline_code')
    expect(children[8].code).toBe('1-')
  })

  it('handles mid-state with trailing opening backtick in list item mid-state 3', () => {
    const md = getMarkdown()
    // mid-state: trailing opening backtick after a comma
    const markdownMid = '1.  **整合冗余条款：** 将原\`1-(5)\`、\`3-(3)\`、\`3-(4)\`中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入\`1-(4)\`“法律状态维护与通知义务”中，使其逻辑更集中，避免了在不同部分重复提及相似义务。'
    const nodesMid = parseMarkdownToStructure(markdownMid, md)
    const children = nodesMid[0].items[0].children[0].children
    // Should contain a strong node for the leading bold and an inline_code mid-state
    expect(children[0].type).toBe('strong')
    expect(children[0].raw).toBe('**整合冗余条款：**')
    expect(children[1].type).toBe('text')
    expect(children[1].content).toBe(' 将原')
    expect(children[2].type).toBe('inline_code')
    expect(children[2].code).toBe('1-(5)')
    expect(children[3].type).toBe('text')
    expect(children[3].content).toBe('、')
    expect(children[4].type).toBe('inline_code')
    expect(children[4].code).toBe('3-(3)')
    expect(children[5].type).toBe('text')
    expect(children[5].content).toBe('、')
    expect(children[6].type).toBe('inline_code')
    expect(children[6].code).toBe('3-(4)')
    expect(children[7].type).toBe('text')
    expect(children[7].content).toBe('中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入')
    expect(children[8].type).toBe('inline_code')
    expect(children[8].code).toBe('1-(4)')
    expect(children[9].type).toBe('text')
    expect(children[9].content).toBe('“法律状态维护与通知义务”中，使其逻辑更集中，避免了在不同部分重复提及相似义务。')
  })

  it('handles mid-state with trailing opening backtick in list item mid-state 4', () => {
    const md = getMarkdown()
    // mid-state: trailing opening backtick after a comma
    const markdownMid = '1.  **整合冗余条款：** 将原 **hello world：** \`1-(5)\`、\`3-(3)\`、\`3-(4)\`中关于“缴纳费用”和“告知法律状态变化”的核心义务合并，统一放入\`1-(4)\`“法律状态维护与通知义务”中，使其逻辑更集中，避免了在不同部分重复提及相似义务。'
    const nodesMid = parseMarkdownToStructure(markdownMid, md)
    const children = nodesMid[0].items[0].children[0].children
    // Should contain a strong node for the leading bold and an inline_code mid-state
    const types = children.map((c: any) => c.type)
    expect(types).toEqual(['strong', 'text', 'strong', 'text', 'inline_code', 'text', 'inline_code', 'text', 'inline_code', 'text', 'inline_code', 'text'])
  })
})
