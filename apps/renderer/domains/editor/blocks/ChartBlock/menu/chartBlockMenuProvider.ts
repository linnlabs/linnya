/**
 * ChartBlock 专属菜单 Provider：块菜单里的“编辑图表”。
 *
 * 阅读类操作（查看数据、阅读选项、恢复默认视图、复制为图片）在图表自己的工具条上；
 * 菜单只补充改变文档内容的入口，且仅在可编辑时出现。
 */

import type { BlockMenuContext, BlockMenuProvider } from '../../../features/blockActionMenu/types'
import { useChartEditingStore } from '../../../features/chart-editing'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import { useRevisionStore } from '../../../features/Revision/useRevisionStore'

function editChart(ctx: BlockMenuContext): void {
  const blockId: unknown = ctx.contentBlockNode.attrs['id']
  if (typeof blockId !== 'string') return
  useChartEditingStore().request({ editorSessionId: ctx.editor.storage.chartBlock.sessionId, blockId })
}

export const chartBlockMenuProvider: BlockMenuProvider = {
  name: 'chart-block-actions',
  weight: 110,

  getItems: ctx => {
    if (!ctx.editor.isEditable) return []
    // 有未决修订时块内容由数据库修订拥有：先接受或拒绝，不在其上编辑。
    const rootBlockId: unknown = ctx.rootBlockNode.attrs['id']
    if (typeof rootBlockId === 'string' && useRevisionStore(ctx.editor).hasCanonicalPending(rootBlockId)) return []
    return [
      { id: 'separator-chart-1', type: 'separator', label: '' },
      {
        id: 'chart-edit',
        label: resolveCurrentEditorMessage('editor.chart.action.edit'),
        action: editChart,
      },
    ]
  },
}
