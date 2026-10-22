// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { MARKDOWN_CHART_TYPES } from '@app/schemas'
import { createChartSlashItems } from './chartSlashItems'

describe('createChartSlashItems', () => {
  const items = createChartSlashItems(key => `<${key}>`, '图表')

  it('八种图表各有一项，顺序与图表类型定义一致', () => {
    expect(items.map(item => item.title)).toEqual(MARKDOWN_CHART_TYPES.map(type => `<editor.chart.type.${type}>`))
    expect(items).toHaveLength(8)
  })

  it('全部归入同一个分组，并带有可检索的别名', () => {
    expect(new Set(items.map(item => item.group))).toEqual(new Set(['图表']))
    for (const item of items) {
      expect(item.aliases).toEqual(expect.arrayContaining(['chart', '图表']))
    }
    expect(items[3]?.aliases).toContain('pie')
  })

  it('Slash 动作删去触发文本，并向正式命令传递所选类型', () => {
    const received: string[] = []
    const capture = Extension.create({ name: 'chartCommandCapture', addCommands() {
      return { convertToSampleChart: (type = 'bar') => ({ tr }) => { received.push(`${type}:${tr.doc.textContent}`); return true } }
    } })
    const editor = new Editor({ extensions: [Document, Paragraph, Text, capture], content: '<p>/chart</p>' })
    try {
      items[5]?.command({ editor, range: { from: 1, to: 7 } })
      expect(received).toEqual(['scatter:'])
      expect(editor.state.doc.textContent).toBe('')
    } finally { editor.destroy() }
  })
})
