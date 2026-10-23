/**
 * @file ChartBlock.ts
 * @description 图表块的 Tiptap 节点：`chartBlock` 原子节点，单一必填属性 `spec`。
 *
 * - 持久语义与 Markdown 一致：`linnya-chart` 围栏 + canonical JSON，规格经严格准入后才进入节点；
 * - 节点只承担结构、HTML 往返与命令；绘制与阅读交互在 chart-reading，源码编辑在 chart-editing；
 * - 每个 Editor 实例持有一个阅读会话身份，关闭文档与删除块时释放会话级阅读状态。
 */

import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { MarkdownChartSpec, MarkdownChartType } from '@app/schemas'
import { useNotificationStore } from '@/app/notification'
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage'
import { buildSampleChartSpec, readChartSampleLabels, useChartEditingStore } from '../../features/chart-editing'
import {
  createChartReadingSessionId,
  disposeChartReadingBlock,
  disposeChartReadingSession,
} from '../../features/chart-reading'
import { buildConvertToChartTransaction } from './functions/chartBlockTransactions'
import { collectRemovedChartBlockIds } from './functions/collectRemovedChartBlockIds'
import {
  CHART_BLOCK_NODE_NAME,
  chartBlockAttributes,
  chartBlockParseRules,
  renderChartBlockHtml,
  renderChartBlockText,
  estimateChartBlockHeight,
} from './chartBlockSchema'
import ChartBlockView from './ui/ChartBlockView.vue'

export interface ChartBlockStorage {
  /** 本 Editor 实例的阅读会话身份。 */
  sessionId: string
}

export interface ConvertToChartBlockOptions {
  /** 转换后立即打开源码编辑面板。 */
  readonly openEditor?: boolean
  /** 规格是插入的示例数据：编辑面板会提示替换为实际数据。 */
  readonly sample?: boolean
}

declare module '@tiptap/core' {
  interface Storage {
    chartBlock: ChartBlockStorage
  }

  interface Commands<ReturnType> {
    chartBlock: {
      /** 把当前内容块转换成图表块；表格内不可转换。 */
      convertToChartBlock: (spec: MarkdownChartSpec, options?: ConvertToChartBlockOptions) => ReturnType
      /** 把当前内容块转换成该类型的示例图表，并打开源码编辑面板（Slash 菜单与图表围栏输入共用）。 */
      convertToSampleChart: (chartType?: MarkdownChartType) => ReturnType
    }
  }
}

export const ChartBlock = Node.create<Record<string, never>, ChartBlockStorage>({
  name: CHART_BLOCK_NODE_NAME,

  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addStorage() {
    return { sessionId: createChartReadingSessionId() }
  },

  extendNodeSchema(extension) {
    return extension.name === CHART_BLOCK_NODE_NAME ? { estimateBlockHeight: estimateChartBlockHeight } : {}
  },

  addAttributes: chartBlockAttributes,

  parseHTML: chartBlockParseRules,

  renderHTML: renderChartBlockHtml,
  renderText: renderChartBlockText,

  addNodeView() {
    // 保留 Tiptap 对原生输入框、工具栏和拖拽的事件隔离；题注容器只阻止自己的按键与鼠标事件。
    return VueNodeViewRenderer(ChartBlockView)
  },

  addCommands() {
    return {
      convertToChartBlock: (spec, options) => ({ state, dispatch }) => {
        const result = buildConvertToChartTransaction(state, spec)
        if (result.kind === 'in-table') {
          if (dispatch) {
            useNotificationStore().show(resolveCurrentEditorMessage('editor.conversion.inTable.chartBlock'), 'warning', 2000)
          }
          return false
        }
        if (result.kind === 'no-block') return false
        if (dispatch && options?.openEditor) {
          useChartEditingStore().request({
            editorSessionId: this.storage.sessionId,
            blockId: result.chartId,
            isSample: options.sample === true,
          })
        }
        return true
      },

      convertToSampleChart: (chartType = 'bar') => ({ commands }) => {
        const sample = buildSampleChartSpec(chartType, readChartSampleLabels(resolveCurrentEditorMessage))
        return commands.convertToChartBlock(sample, { openEditor: true, sample: true })
      },

    }
  },

  onTransaction({ transaction, appendedTransactions }) {
    for (const applied of [transaction, ...appendedTransactions]) {
      for (const blockId of collectRemovedChartBlockIds(applied)) {
        disposeChartReadingBlock(this.storage.sessionId, blockId)
      }
    }
  },

  onDestroy() {
    disposeChartReadingSession(this.storage.sessionId)
  },
})

export default ChartBlock
