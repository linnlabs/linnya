/**
 * @file citation/__tests__/bibliographyAutoMaintain.spec.ts
 * @description 参考文献自动维护逻辑的单元测试
 *
 * 覆盖用例：
 * - 无 citations：doc（无 CitationNode）→ 期望不需要 bibliography
 * - 新增一个 citation：doc（含 1 CitationNode）→ 期望需要创建 bibliography（文末）
 * - 移除最后一个 citation：doc（bibliography 存在但 citationCount=0）→ 期望移除 bibliography
 * - 重复容器块：doc（2 个 bibliography rootBlock）→ 期望收敛为 1 个
 * - 不在文末：doc（bibliography 在中间）→ 期望移动到末尾
 * - 幂等性：对"已满足规则"的 doc 运行修正 → 不产生 fixTr
 */

import { describe, it, expect } from 'vitest'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  scanDocForCitations,
  computeBibliographyFixActions,
  createBibliographyBlockJSON,
} from '../plugins/bibliographyAutoMaintain'
import type { DocCitationScanResult } from '../types'

describe('bibliographyAutoMaintain', () => {
  describe('computeBibliographyFixActions', () => {
    it('无 citations，无 bibliography：不需要修正', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 0,
        bibliographyRootBlockPosList: [],
        isBibliographyAtEnd: false,
        docEndPos: 100,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(false)
      expect(result.actions).toHaveLength(0)
    })

    it('无 citations，有 bibliography：需要移除', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 0,
        bibliographyRootBlockPosList: [80],
        isBibliographyAtEnd: true,
        docEndPos: 100,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toEqual({
        type: 'remove',
        positions: [80],
      })
    })

    it('有 citations，无 bibliography：需要创建', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 3,
        bibliographyRootBlockPosList: [],
        isBibliographyAtEnd: false,
        docEndPos: 150,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toEqual({
        type: 'create',
        insertPos: 150,
      })
    })

    it('有 citations，有 bibliography 且在文末：不需要修正', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 2,
        bibliographyRootBlockPosList: [120],
        isBibliographyAtEnd: true,
        docEndPos: 150,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(false)
      expect(result.actions).toHaveLength(0)
    })

    it('有 citations，有 bibliography 但不在文末：需要移动', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 2,
        bibliographyRootBlockPosList: [50],
        isBibliographyAtEnd: false,
        docEndPos: 150,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toEqual({
        type: 'move_to_end',
        fromPos: 50,
        toPos: 150,
      })
    })

    it('有 citations，多个 bibliography：需要清理重复', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 2,
        bibliographyRootBlockPosList: [30, 80, 120],
        isBibliographyAtEnd: false,
        docEndPos: 150,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toEqual({
        type: 'cleanup_duplicates',
        keepPos: 120, // 保留最后一个
        removePositions: [30, 80], // 移除前面的
      })
    })

    it('无 citations，多个 bibliography：全部移除', () => {
      const scanResult: DocCitationScanResult = {
        citationCount: 0,
        bibliographyRootBlockPosList: [30, 80],
        isBibliographyAtEnd: false,
        docEndPos: 100,
      }

      const result = computeBibliographyFixActions(scanResult)

      expect(result.needsFix).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toEqual({
        type: 'remove',
        positions: [30, 80],
      })
    })
  })

  describe('createBibliographyBlockJSON', () => {
    it('创建默认 numeric 样式的 bibliography JSON', () => {
      const json = createBibliographyBlockJSON()

      expect(json.type).toBe('rootBlock')
      expect(json.content).toHaveLength(1)
      expect(json.content[0].type).toBe('bibliographyBlock')
      expect(json.content[0].attrs.styleId).toBe('numeric')
      expect(json.content[0].attrs.blockType).toBe('bibliography')
    })

    it('创建 author-date 样式的 bibliography JSON', () => {
      const json = createBibliographyBlockJSON('author-date')

      expect(json.type).toBe('rootBlock')
      expect(json.content[0].attrs.styleId).toBe('author-date')
    })
  })

  it('从真实文档结构扫描 CitationNode，并识别文末 bibliography', () => {
    const doc = workspaceMarkdownSchemaLite.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'content-root' },
          content: [
            {
              type: 'baseBlock',
              attrs: { id: 'content-block', blockType: 'base' },
              content: [
                { type: 'text', text: '结论' },
                {
                  type: 'citationNode',
                  attrs: {
                    citationId: 'citation-1',
                    ref: 'abc123',
                    sourceType: 'knowledge_base',
                    sourceId: 'doc-1',
                    blockId: 'block-1',
                    title: '文献',
                    snippet: '原文',
                  },
                },
              ],
            },
          ],
        },
        createBibliographyBlockJSON(),
      ],
    })

    const scan = scanDocForCitations(doc)
    expect(scan.citationCount).toBe(1)
    expect(scan.bibliographyRootBlockPosList).toHaveLength(1)
    expect(scan.isBibliographyAtEnd).toBe(true)
  })
})
