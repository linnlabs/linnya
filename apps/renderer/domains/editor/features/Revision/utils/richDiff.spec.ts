/**
 * @file richDiff.spec.ts
 * @description richDiff 单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  computeRichDiff,
  computeRichDiffFromText,
  hasFormatChanges,
  type RichDiffSegment,
} from './richDiff'
import type { TextSpan } from '../protocol/revisionTextSpanTypes'

describe('richDiff', () => {
  describe('computeRichDiff', () => {
    // ==================== 基础用例 ====================

    it('应正确处理无变化的情况', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]
      const newSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]

      const result = computeRichDiff(originalSpans, newSpans)

      expect(result.segments).toEqual([{ type: 'equal', text: 'Hello', unitCount: 5 }])
      expect(result.stats.insertCount).toBe(0)
      expect(result.stats.deleteCount).toBe(0)
    })

    it('应正确处理纯文本修改（无格式）', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]
      const newSpans: TextSpan[] = [{ text: 'Hi', marks: [] }]

      const result = computeRichDiff(originalSpans, newSpans)

      // diff-match-patch 的具体结果可能不同，只验证基本结构
      expect(result.segments.length).toBeGreaterThan(0)
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('应正确处理空输入', () => {
      const originalSpans: TextSpan[] = []
      const newSpans: TextSpan[] = []

      const result = computeRichDiff(originalSpans, newSpans)

      expect(result.segments).toEqual([])
      expect(result.stats.insertCount).toBe(0)
      expect(result.stats.deleteCount).toBe(0)
    })

    // ==================== 格式变化 ====================

    it('应为新插入的文本附加 marks', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Hello', marks: [] },
        { text: ' World', marks: ['bold'] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 找到 insert 段
      const insertSegment = result.segments.find((s) => s.type === 'insert')
      expect(insertSegment).toBeDefined()
      expect(insertSegment?.marks).toContain('bold')
    })

    it('应正确处理整段带格式的新内容', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]
      const newSpans: TextSpan[] = [{ text: 'Hello World', marks: ['bold'] }]

      const result = computeRichDiff(originalSpans, newSpans)

      // 新增的 " World" 部分应该带有 bold
      const insertSegments = result.segments.filter((s) => s.type === 'insert')
      const hasMarkedInsert = insertSegments.some(
        (s) => s.marks && s.marks.includes('bold')
      )
      expect(hasMarkedInsert).toBe(true)
    })

    it('应正确处理多种格式混合', () => {
      const originalSpans: TextSpan[] = [{ text: 'Text', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Text', marks: [] },
        { text: ' bold', marks: ['bold'] },
        { text: ' italic', marks: ['italic'] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 验证有多个 insert 段，各自带不同的 marks
      const insertSegments = result.segments.filter((s) => s.type === 'insert')
      expect(insertSegments.length).toBeGreaterThan(0)
    })

    it('应正确处理 bold+italic 组合 marks', () => {
      const originalSpans: TextSpan[] = []
      const newSpans: TextSpan[] = [
        { text: 'both', marks: ['bold', 'italic'] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      const insertSegment = result.segments.find((s) => s.type === 'insert')
      expect(insertSegment?.marks).toContain('bold')
      expect(insertSegment?.marks).toContain('italic')
    })

    it('应为 citation token 插入段附加 citation 元数据', () => {
      const originalSpans: TextSpan[] = [{ text: '前文：', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: '前文：', marks: [] },
        {
          text: '[@Abc234]',
          marks: [],
          citation: {
            ref: 'Abc234',
            sourceId: 'doc_1',
            title: '测试文档',
            snippet: '测试片段',
            kbId: 'kb_1',
          },
        },
      ]

      const result = computeRichDiff(originalSpans, newSpans)
      const citationInsert = result.segments.find(
        (s) => s.type === 'insert' && s.text === '[@Abc234]'
      )
      expect(citationInsert).toBeDefined()
      expect(citationInsert?.citation?.ref).toBe('Abc234')
      expect(citationInsert?.citation?.sourceId).toBe('doc_1')
    })

    it('应把 inlineLatex 作为原子单元插入，而不是降级成普通文本片段', () => {
      const originalSpans: TextSpan[] = [{ text: '公式：', marks: [] }]
      const newSpans: TextSpan[] = [
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
      ]

      const result = computeRichDiff(originalSpans, newSpans)
      const atomInsert = result.segments.find(
        (segment) => segment.type === 'insert' && segment.inlineAtom?.type === 'inlineLatex'
      )

      expect(atomInsert).toBeDefined()
      expect(atomInsert?.text).toBe('$E=mc^2$')
      expect(atomInsert?.inlineAtom).toEqual({
        type: 'inlineLatex',
        latexSource: 'E=mc^2',
        textRepresentation: '$E=mc^2$',
        attrs: { latexSource: 'E=mc^2' },
      })
    })

    it('当纯文本相同但 citation 元数据变化时，应输出 delete+insert', () => {
      const originalSpans: TextSpan[] = [{ text: '[@Abc234]', marks: [] }]
      const newSpans: TextSpan[] = [
        {
          text: '[@Abc234]',
          marks: [],
          citation: {
            ref: 'Abc234',
            sourceId: 'doc_1',
            title: '测试文档',
            snippet: '测试片段',
          },
        },
      ]

      const result = computeRichDiff(originalSpans, newSpans)
      const hasDelete = result.segments.some((s) => s.type === 'delete')
      const hasCitationInsert = result.segments.some(
        (s) => s.type === 'insert' && s.citation?.ref === 'Abc234'
      )
      expect(hasDelete).toBe(true)
      expect(hasCitationInsert).toBe(true)
    })

    // ==================== delete 段 ====================

    it('delete 段不应有 marks 属性', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello World', marks: ['bold'] }]
      const newSpans: TextSpan[] = [{ text: 'Hello', marks: [] }]

      const result = computeRichDiff(originalSpans, newSpans)

      const deleteSegments = result.segments.filter((s) => s.type === 'delete')
      for (const seg of deleteSegments) {
        expect(seg.marks).toBeUndefined()
      }
    })

    // ==================== 复杂场景 ====================

    it('应正确处理文本开头的格式变化', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello World', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Hi', marks: ['bold'] },
        { text: ' World', marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 应该有 delete 和 insert
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('应正确处理文本中间的格式变化', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello World Today', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Hello ', marks: [] },
        { text: 'Beautiful', marks: ['italic'] },
        { text: ' Today', marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 应该有变化
      expect(result.segments.length).toBeGreaterThan(1)
    })

    // ==================== 纯文本不变，仅格式变化 ====================

    it('当纯文本相同但 bold 变化时，应输出 delete+insert 并携带 bold mark', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello World', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Hello', marks: ['bold'] },
        { text: ' World', marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 应该有 delete + insert
      const hasDelete = result.segments.some((s) => s.type === 'delete')
      const insertWithBold = result.segments.find(
        (s) => s.type === 'insert' && s.marks?.includes('bold')
      )
      expect(hasDelete).toBe(true)
      expect(insertWithBold).toBeDefined()
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('当纯文本相同但 italic 变化时，应输出 delete+insert 并携带 italic mark', () => {
      const originalSpans: TextSpan[] = [{ text: 'Hello World', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'Hello', marks: ['italic'] },
        { text: ' World', marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      const hasDelete = result.segments.some((s) => s.type === 'delete')
      const insertWithItalic = result.segments.find(
        (s) => s.type === 'insert' && s.marks?.includes('italic')
      )
      expect(hasDelete).toBe(true)
      expect(insertWithItalic).toBeDefined()
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('当纯文本相同但 code 变化时，应输出 delete+insert 并携带 code mark', () => {
      const originalSpans: TextSpan[] = [{ text: 'foo bar', marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'foo', marks: ['code'] },
        { text: ' bar', marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      const hasDelete = result.segments.some((s) => s.type === 'delete')
      const insertWithCode = result.segments.find(
        (s) => s.type === 'insert' && s.marks?.includes('code')
      )
      expect(hasDelete).toBe(true)
      expect(insertWithCode).toBeDefined()
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('当纯文本相同但 strike 变化时，应输出 delete+insert 并携带 strike mark', () => {
      const originalSpans: TextSpan[] = [{ text: 'to be removed', marks: [] }]
      const newSpans: TextSpan[] = [{ text: 'to be removed', marks: ['strike'] }]

      const result = computeRichDiff(originalSpans, newSpans)

      const hasDelete = result.segments.some((s) => s.type === 'delete')
      const insertWithStrike = result.segments.find(
        (s) => s.type === 'insert' && s.marks?.includes('strike')
      )
      expect(hasDelete).toBe(true)
      expect(insertWithStrike).toBeDefined()
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('当纯文本相同但 bold+italic 组合变化时，应输出含组合 marks 的 insert 段', () => {
      const originalSpans: TextSpan[] = [{ text: 'both', marks: [] }]
      const newSpans: TextSpan[] = [{ text: 'both', marks: ['bold', 'italic'] }]

      const result = computeRichDiff(originalSpans, newSpans)

      const insertWithCombo = result.segments.find((s) => s.type === 'insert')
      expect(insertWithCombo).toBeDefined()
      expect(insertWithCombo?.marks).toEqual(expect.arrayContaining(['bold', 'italic']))
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)
    })

    it('应同时检测文本改写与 Markdown 格式变化（长中文段落）', () => {
      const originalText =
        '在软件工程的浩瀚星海中，代码质量是衡量一个项目能否长久生存的关键指标。许多开发者往往只关注功能的实现，而忽视子代码的可读性与可维护性。这就好比盖房子，只在平外观是否华丽，却不管地基是否牢固。随着时间的推移，技术债务会像滚雪球一样越积越多，最终导致项目崩溃。因此，重构不仅仅是修修补补，更是一场对代码灵魂的救赎。我们需要在每一次提交中都保持警惕，让代码像诗一样优雅。'

      // 中文说明：
      // - 这里显式构造 spans fixture，而不是依赖 legacy parser；
      // - 本用例要验证的是 richDiff 对“长文本改写 + 带 marks spans”的处理，
      //   而不是验证 legacy Markdown 解析行为。
      const newSpans: TextSpan[] = [
        { text: '在软件工程的', marks: [] },
        { text: '广袤宇宙', marks: ['bold'] },
        {
          text: '中，代码质量是衡量一个项目能否长久生存的关键指标。',
          marks: [],
        },
        { text: '优秀的工程师', marks: ['italic'] },
        {
          text:
            '深知，代码不仅是写给机器执行的，更是写给人类阅读的。譬如盖房子，只在乎外观是否华丽，却不管结构是否稳健且安全。随着时间的推移，',
          marks: [],
        },
        { text: '技术债务', marks: ['italic'] },
        {
          text: '会像滚雪球一样越积越多，最终导致项目坍塌。因此，',
          marks: [],
        },
        { text: '重构', marks: ['code'] },
        {
          text:
            '不仅仅是修修补补，更是一场对架构与代码的体检。我们需要在每一次提交中都保持警惕，让代码如诗般优雅。',
          marks: [],
        },
      ]

      const result = computeRichDiffFromText(originalText, newSpans)

      // 应有文本插入与删除
      expect(result.stats.insertCount).toBeGreaterThan(0)
      expect(result.stats.deleteCount).toBeGreaterThan(0)

      // 应存在格式化的插入段
      const insertWithMarks = result.segments.find(
        (s) => s.type === 'insert' && s.marks && s.marks.length > 0
      )
      expect(insertWithMarks).toBeDefined()

      // 文本改写应包含“坍塌”，删除应包含“崩溃”
      const hasCollapseInsert = result.segments.some(
        (s) => s.type === 'insert' && s.text.includes('坍塌')
      )
      const hasCollapseDelete = result.segments.some(
        (s) => s.type === 'delete' && s.text.includes('崩溃')
      )
      expect(hasCollapseInsert).toBe(true)
      expect(hasCollapseDelete).toBe(true)
    })
  })

  describe('computeRichDiffFromText', () => {
    it('应正确处理纯文本输入', () => {
      const originalText = 'Hello'
      const newSpans: TextSpan[] = [{ text: 'Hello World', marks: ['bold'] }]

      const result = computeRichDiffFromText(originalText, newSpans)

      expect(result.segments.length).toBeGreaterThan(0)
      const insertSegment = result.segments.find((s) => s.type === 'insert')
      expect(insertSegment?.marks).toContain('bold')
    })

    it('应正确处理空字符串输入', () => {
      const originalText = ''
      const newSpans: TextSpan[] = [{ text: 'New', marks: ['bold'] }]

      const result = computeRichDiffFromText(originalText, newSpans)

      expect(result.segments).toEqual([
        { type: 'insert', text: 'New', unitCount: 3, marks: ['bold'] },
      ])
    })
  })

  describe('hasFormatChanges', () => {
    it('应检测到有格式变化', () => {
      const segments: RichDiffSegment[] = [
        { type: 'equal', text: 'Hello' },
        { type: 'insert', text: 'World', marks: ['bold'] },
      ]

      expect(hasFormatChanges(segments)).toBe(true)
    })

    it('应检测到无格式变化', () => {
      const segments: RichDiffSegment[] = [
        { type: 'equal', text: 'Hello' },
        { type: 'insert', text: 'World' },
      ]

      expect(hasFormatChanges(segments)).toBe(false)
    })

    it('应正确处理空数组', () => {
      expect(hasFormatChanges([])).toBe(false)
    })

    it('应正确处理只有 delete 的情况', () => {
      const segments: RichDiffSegment[] = [
        { type: 'equal', text: 'Hello' },
        { type: 'delete', text: 'World' },
      ]

      expect(hasFormatChanges(segments)).toBe(false)
    })

    it('应检测到空 marks 数组为无格式变化', () => {
      const segments: RichDiffSegment[] = [
        { type: 'insert', text: 'World', marks: [] },
      ]

      expect(hasFormatChanges(segments)).toBe(false)
    })
  })

  // ==================== 回归测试 ====================

  describe('回归测试', () => {
    it('确保 marks 并集逻辑正确', () => {
      // 当 insert 跨越多个不同格式的 spans 时，应该收集所有 marks
      const originalSpans: TextSpan[] = []
      const newSpans: TextSpan[] = [
        { text: 'A', marks: ['bold'] },
        { text: 'B', marks: ['italic'] },
        { text: 'C', marks: ['code'] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 如果 diff 把 ABC 作为一个整体插入，应该包含所有 marks
      // 如果分开插入，各自应该有对应的 mark
      const insertSegments = result.segments.filter((s) => s.type === 'insert')
      expect(insertSegments.length).toBeGreaterThan(0)

      // 收集所有 insert 段的 marks
      const allMarks = new Set<string>()
      for (const seg of insertSegments) {
        if (seg.marks) {
          seg.marks.forEach((m) => allMarks.add(m))
        }
      }

      // 应该至少包含 bold、italic、code 中的一部分
      expect(allMarks.size).toBeGreaterThan(0)
    })

    it('确保坐标映射在长文本中正确', () => {
      const originalText = 'A'.repeat(100)
      const newText = 'A'.repeat(50) + 'B'.repeat(10) + 'A'.repeat(50)

      const originalSpans: TextSpan[] = [{ text: originalText, marks: [] }]
      const newSpans: TextSpan[] = [
        { text: 'A'.repeat(50), marks: [] },
        { text: 'B'.repeat(10), marks: ['bold'] },
        { text: 'A'.repeat(50), marks: [] },
      ]

      const result = computeRichDiff(originalSpans, newSpans)

      // 应该有 insert 段，且带有 bold mark
      const insertWithBold = result.segments.find(
        (s) => s.type === 'insert' && s.marks?.includes('bold')
      )
      expect(insertWithBold).toBeDefined()
    })
  })
})
