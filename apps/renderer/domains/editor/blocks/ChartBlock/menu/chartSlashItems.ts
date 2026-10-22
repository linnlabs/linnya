/**
 * @file chartSlashItems.ts
 * @description Slash 菜单里的“图表”分组：八种图表各一项，选择后得到明确标注为示例数据的合法图表并打开源码面板。
 *
 * 条目只描述标题、检索别名和命令；插入逻辑由 ChartBlock 的 `convertToSampleChart` 命令承担，
 * Slash 扩展不需要了解图表规格。
 */

import type { Editor, Range } from '@tiptap/core'
import { MARKDOWN_CHART_TYPES, type MarkdownChartType } from '@app/schemas'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'

export interface ChartSlashItem {
  readonly title: string
  readonly aliases: readonly string[]
  readonly group: string
  readonly command: (context: { editor: Editor; range: Range }) => void
}

function aliasesOf(chartType: MarkdownChartType, localizedTitle: string): readonly string[] {
  return ['chart', 'graph', '图表', chartType, localizedTitle]
}

export function createChartSlashItems(editorMessage: EditorMessageResolver, group: string): readonly ChartSlashItem[] {
  return MARKDOWN_CHART_TYPES.map((chartType): ChartSlashItem => {
    const title = editorMessage(`editor.chart.type.${chartType}`)
    return {
      title,
      aliases: aliasesOf(chartType, title),
      group,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).convertToSampleChart(chartType).run()
      },
    }
  })
}
