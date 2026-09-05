import { describe, expect, it } from 'vitest'
import { getMarkdown, parseMarkdownToStructure } from '../src'

function collectLinkHrefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectLinkHrefs)
  if (typeof value !== 'object' || value === null) return []

  const record = value as Record<string, unknown>
  const ownHref = record.type === 'link' && typeof record.href === 'string'
    ? [record.href]
    : []
  return [...ownHref, ...Object.values(record).flatMap(collectLinkHrefs)]
}

describe('parseMarkdownToStructure - duplicate question rendering', () => {
  it('只为调用方显式声明的产品协议保留 Markdown link AST', () => {
    const md = getMarkdown('custom-link-protocols', {
      allowedLinkProtocols: ['workspace', 'conversation:', 'file'],
    })
    const nodes = parseMarkdownToStructure([
      '[文档](<workspace:/项目 报告.md>)',
      '[预览](conversation:/renders/preview.png)',
      '[外部文件](<file:///tmp/report.pdf>)',
      '[危险链接](javascript:alert(1))',
    ].join('\n\n'), md)

    expect(collectLinkHrefs(nodes)).toEqual([
      'workspace:/%E9%A1%B9%E7%9B%AE%20%E6%8A%A5%E5%91%8A.md',
      'conversation:/renders/preview.png',
      'file:///tmp/report.pdf',
    ])
  })

  it('does not duplicate the question text when parsing mixed math/ce commands', () => {
    const md = getMarkdown()

    const markdown = `**当堂检测**：  
1. 下列物质属于酚的是（ ）  
   A. $\ce{CH3CH2OH}$  B. $\ce{C6H5CH2OH}$  C. $\ce{}$  D. $\ce{HO-CH2-CH2OH}$  
   **答案**：C`

    const nodes = parseMarkdownToStructure(markdown, md)
    // collect all textual content from the parsed nodes
    function collectTexts(n: any): string[] {
      if (!n)
        return []
      if (Array.isArray(n))
        return n.flatMap(collectTexts)
      if (typeof n === 'string')
        return [n]
      const texts: string[] = []
      if (n.type === 'text' && typeof n.content === 'string')
        texts.push(n.content)
      if (n.children && Array.isArray(n.children))
        texts.push(...n.children.flatMap(collectTexts))
      if (n.items && Array.isArray(n.items))
        texts.push(...n.items.flatMap(collectTexts))
      return texts
    }

    const allTexts = collectTexts(nodes).join('\n')
    // Count occurrences of the core question string
    const needle = '下列物质属于酚的是'
    const occurrences = (allTexts.match(new RegExp(needle, 'g')) || []).length

    expect(occurrences).toBe(1)
  })
})
