/**
 * @file ChartBlockReadonly.ts
 * @description 只读场景（块历史）使用的 `chartBlock`：与主编辑器同一 schema，只带一个只读 NodeView。
 *
 * 没有命令、会话存储和编辑入口；读者仍可查看数据表、使用阅读选项和复制图片，状态只存在于该视图内。
 */

import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import {
  CHART_BLOCK_NODE_NAME,
  chartBlockAttributes,
  chartBlockParseRules,
  renderChartBlockHtml,
  renderChartBlockText,
} from './chartBlockSchema'
import ChartReadonlyView from './ui/ChartReadonlyView.vue'

export const ChartBlockReadonly = Node.create({
  name: CHART_BLOCK_NODE_NAME,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: chartBlockAttributes,
  parseHTML: chartBlockParseRules,
  renderHTML: renderChartBlockHtml,
  renderText: renderChartBlockText,
  addNodeView() {
    return VueNodeViewRenderer(ChartReadonlyView)
  },
})
