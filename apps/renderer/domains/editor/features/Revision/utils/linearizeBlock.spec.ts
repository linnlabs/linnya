/**
 * @file linearizeBlock.spec.ts
 * @description linearizeBlock 单元测试
 *
 * 注意：这里主要测试 linearizeNode，因为 linearizeRootBlock 依赖 Editor 实例，
 * 需要在集成测试中验证。
 */

import { describe, it, expect } from 'vitest'
import { linearizeNode } from './linearizeBlock'

// ==================== Mock ProseMirror Node ====================

/**
 * 创建模拟的 ProseMirror 文本节点
 */
function createTextNode(
  text: string,
  marks: Array<{ type: { name: string }; attrs?: Record<string, unknown> }> = []
): any {
  return {
    isText: true,
    text,
    marks,
    type: { name: 'text' },
    content: null,
  }
}

/**
 * 创建模拟的 ProseMirror hardBreak 节点
 */
function createHardBreakNode(): any {
  return {
    isText: false,
    type: { name: 'hardBreak' },
    marks: [],
    content: null,
  }
}

function createInlineLatexNode(
  latexSource: string,
  marks: Array<{ type: { name: string }; attrs?: Record<string, unknown> }> = []
): any {
  return {
    isText: false,
    type: { name: 'inlineLatex' },
    attrs: { latexSource },
    marks,
    content: null,
  }
}

function createCitationNode(
  attrs: Record<string, unknown>,
  marks: Array<{ type: { name: string }; attrs?: Record<string, unknown> }> = []
) {
  return {
    isText: false,
    type: { name: 'citationNode' },
    attrs,
    marks,
    content: null,
  }
}

/**
 * 创建模拟的 ProseMirror 容器节点
 */
function createContainerNode(children: any[]): any {
  return {
    isText: false,
    type: { name: 'baseBlock' },
    marks: [],
    content: {
      forEach: (callback: (node: any) => void) => {
        children.forEach(callback)
      },
    },
  }
}

/**
 * 创建模拟的 bold mark
 */
function createBoldMark(): { type: { name: string } } {
  return { type: { name: 'bold' } }
}

/**
 * 创建模拟的 italic mark
 */
function createItalicMark(): { type: { name: string } } {
  return { type: { name: 'italic' } }
}

/**
 * 创建模拟的 code mark
 */
function createCodeMark(): { type: { name: string } } {
  return { type: { name: 'code' } }
}

/**
 * 创建模拟的 strike mark
 */
function createStrikeMark(): { type: { name: string } } {
  return { type: { name: 'strike' } }
}

// ==================== 测试用例 ====================

describe('linearizeBlock', () => {
  describe('linearizeNode', () => {
    // ==================== 基础用例 ====================

    it('应正确处理纯文本节点', () => {
      const node = createContainerNode([createTextNode('Hello World')])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([{ text: 'Hello World', marks: [] }])
      expect(result.plainText).toBe('Hello World')
    })

    it('应正确处理空节点', () => {
      const node = createContainerNode([])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([])
      expect(result.plainText).toBe('')
    })

    // ==================== 单一格式 ====================

    it('应正确提取 bold mark', () => {
      const node = createContainerNode([
        createTextNode('Hello '),
        createTextNode('World', [createBoldMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'Hello ', marks: [] },
        { text: 'World', marks: ['bold'] },
      ])
      expect(result.plainText).toBe('Hello World')
    })

    it('应正确提取 italic mark', () => {
      const node = createContainerNode([
        createTextNode('Hello '),
        createTextNode('World', [createItalicMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'Hello ', marks: [] },
        { text: 'World', marks: ['italic'] },
      ])
    })

    it('应正确提取 code mark', () => {
      const node = createContainerNode([
        createTextNode('Hello '),
        createTextNode('World', [createCodeMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'Hello ', marks: [] },
        { text: 'World', marks: ['code'] },
      ])
    })

    it('应正确提取 strike mark', () => {
      const node = createContainerNode([
        createTextNode('Hello '),
        createTextNode('World', [createStrikeMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'Hello ', marks: [] },
        { text: 'World', marks: ['strike'] },
      ])
    })

    // ==================== 组合格式 ====================

    it('应正确提取多个 marks', () => {
      const node = createContainerNode([
        createTextNode('Hello', [createBoldMark(), createItalicMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([{ text: 'Hello', marks: ['bold', 'italic'] }])
    })

    it('应正确处理多种格式混合', () => {
      const node = createContainerNode([
        createTextNode('bold', [createBoldMark()]),
        createTextNode(' and '),
        createTextNode('italic', [createItalicMark()]),
        createTextNode(' and '),
        createTextNode('code', [createCodeMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'bold', marks: ['bold'] },
        { text: ' and ', marks: [] },
        { text: 'italic', marks: ['italic'] },
        { text: ' and ', marks: [] },
        { text: 'code', marks: ['code'] },
      ])
      expect(result.plainText).toBe('bold and italic and code')
    })

    it('应保留 citation 的 canonical ref 与 Knowledge 块锚点', () => {
      const node = createContainerNode([
        createCitationNode(
          {
            ref: 'Abc234',
            sourceType: 'knowledge_base',
            sourceId: 'doc-1',
            kbId: 'kb-1',
            blockId: 'block-1',
            title: '文献标题',
            snippet: '文献原文',
          },
          [createItalicMark()]
        ),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        {
          text: '[@Abc234]',
          marks: ['italic'],
          citation: {
            ref: 'Abc234',
            sourceType: 'knowledge_base',
            sourceId: 'doc-1',
            kbId: 'kb-1',
            blockId: 'block-1',
            title: '文献标题',
            snippet: '文献原文',
            url: undefined,
            date: undefined,
            authors: undefined,
            containerTitle: undefined,
          },
          inlineAtom: {
            type: 'citation',
            citation: {
              ref: 'Abc234',
              sourceType: 'knowledge_base',
              sourceId: 'doc-1',
              kbId: 'kb-1',
              blockId: 'block-1',
              title: '文献标题',
              snippet: '文献原文',
              url: undefined,
              date: undefined,
              authors: undefined,
              containerTitle: undefined,
            },
            textRepresentation: '[@Abc234]',
          },
        },
      ])
      expect(result.plainText).toBe('[@Abc234]')
    })

    // ==================== hardBreak 处理 ====================

    it('应正确处理 hardBreak 节点', () => {
      const node = createContainerNode([
        createTextNode('Line 1'),
        createHardBreakNode(),
        createTextNode('Line 2'),
      ])

      const result = linearizeNode(node)

      // 由于 hardBreak 生成的 \n 和相邻文本都是空 marks，会被合并
      expect(result.spans).toEqual([{ text: 'Line 1\nLine 2', marks: [] }])
      expect(result.plainText).toBe('Line 1\nLine 2')
    })

    it('应正确处理 hardBreak 在格式化文本之间', () => {
      const node = createContainerNode([
        createTextNode('Line 1', [createBoldMark()]),
        createHardBreakNode(),
        createTextNode('Line 2', [createBoldMark()]),
      ])

      const result = linearizeNode(node)

      // hardBreak 无 marks，会分隔 bold 文本
      expect(result.spans).toEqual([
        { text: 'Line 1', marks: ['bold'] },
        { text: '\n', marks: [] },
        { text: 'Line 2', marks: ['bold'] },
      ])
      expect(result.plainText).toBe('Line 1\nLine 2')
    })

    it('应将 inlineLatex 线性化为稳定文本表示', () => {
      const node = createContainerNode([createTextNode('公式：'), createInlineLatexNode('E=mc^2')])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: '公式：', marks: [] },
        {
          text: '$E=mc^2$',
          marks: [],
          inlineAtom: {
            type: 'inlineLatex',
            latexSource: 'E=mc^2',
            textRepresentation: '$E=mc^2$',
            attrs: { latexSource: 'E=mc^2' },
          },
        },
      ])
      expect(result.plainText).toBe('公式：$E=mc^2$')
    })

    it('应保留 inlineLatex 相邻文本的 marks 边界', () => {
      const node = createContainerNode([
        createTextNode('A', [createBoldMark()]),
        createInlineLatexNode('x+y'),
        createTextNode('B', [createBoldMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'A', marks: ['bold'] },
        {
          text: '$x+y$',
          marks: [],
          inlineAtom: {
            type: 'inlineLatex',
            latexSource: 'x+y',
            textRepresentation: '$x+y$',
            attrs: { latexSource: 'x+y' },
          },
        },
        { text: 'B', marks: ['bold'] },
      ])
      expect(result.plainText).toBe('A$x+y$B')
    })

    // ==================== 相邻合并 ====================

    it('应合并相邻的同类 spans', () => {
      const node = createContainerNode([
        createTextNode('Hello'),
        createTextNode(' '),
        createTextNode('World'),
      ])

      const result = linearizeNode(node)

      // 应该合并为一个 span
      expect(result.spans).toEqual([{ text: 'Hello World', marks: [] }])
    })

    it('应合并相邻的具有相同 marks 的 spans', () => {
      const node = createContainerNode([
        createTextNode('Hello', [createBoldMark()]),
        createTextNode(' ', [createBoldMark()]),
        createTextNode('World', [createBoldMark()]),
      ])

      const result = linearizeNode(node)

      // 应该合并为一个 span
      expect(result.spans).toEqual([{ text: 'Hello World', marks: ['bold'] }])
    })

    it('不应合并具有不同 marks 的 spans', () => {
      const node = createContainerNode([
        createTextNode('Hello', [createBoldMark()]),
        createTextNode('World', [createItalicMark()]),
      ])

      const result = linearizeNode(node)

      expect(result.spans).toEqual([
        { text: 'Hello', marks: ['bold'] },
        { text: 'World', marks: ['italic'] },
      ])
    })

    // ==================== 不支持的 marks ====================

    it('应忽略不支持的 mark 类型', () => {
      const node = createContainerNode([createTextNode('Hello', [{ type: { name: 'textColor' } }])])

      const result = linearizeNode(node)

      // textColor 不在支持列表中，应被忽略
      expect(result.spans).toEqual([{ text: 'Hello', marks: [] }])
    })

    it('应保留支持的 marks 并忽略不支持的', () => {
      const node = createContainerNode([
        createTextNode('Hello', [
          createBoldMark(),
          { type: { name: 'textColor' } },
          { type: { name: 'revisionMark' } },
        ]),
      ])

      const result = linearizeNode(node)

      // 只保留 bold
      expect(result.spans).toEqual([{ text: 'Hello', marks: ['bold'] }])
    })

    // ==================== 嵌套节点 ====================

    it('应正确处理嵌套容器节点', () => {
      const innerNode = createContainerNode([createTextNode('Inner', [createBoldMark()])])

      const outerNode = createContainerNode([innerNode])

      const result = linearizeNode(outerNode)

      expect(result.spans).toEqual([{ text: 'Inner', marks: ['bold'] }])
    })
  })
})
