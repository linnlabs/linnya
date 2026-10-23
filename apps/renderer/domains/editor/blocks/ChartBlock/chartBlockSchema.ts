/**
 * @file chartBlockSchema.ts
 * @description `chartBlock` 的 schema 定义：属性、HTML 解析与渲染规则。
 *
 * 主编辑器（可交互）和历史视图（只读）使用同一份 schema，两者的差别只在 NodeView 与命令。
 * 因此规格准入、HTML 往返和属性合同只在这里维护一次。
 */

import { mergeAttributes, type Attributes, type NodeConfig } from '@tiptap/core'
import {
  admitMarkdownChartFenceBody,
  isMarkdownChartFenceLanguage,
  MarkdownChartSpecSchema,
  MarkdownChartSpecInvalidError,
} from '@app/schemas'
import { plotHeightOf, resolveLegendPosition } from '../../features/chart-reading'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import { CHART_FIGURE_SELECTOR, chartFigureDomSpec, readChartFigure } from './functions/chartFigureHtml'

export const CHART_BLOCK_NODE_NAME = 'chartBlock'

export function chartBlockAttributes(): Attributes {
  return {
    id: {
      default: () => generateBlockId(),
      parseHTML: element => element.getAttribute('data-id') || generateBlockId(),
      renderHTML: attributes => ({ 'data-id': attributes['id'] }),
    },
    blockType: {
      default: 'chart',
      parseHTML: element => element.getAttribute('data-block-type') || 'chart',
      renderHTML: attributes => ({ 'data-block-type': attributes['blockType'] }),
    },
    // 与后端 schema 同一合同：没有默认值，写入前必须已通过准入。
    spec: {
      rendered: false,
      validate: (value: unknown) => { MarkdownChartSpecSchema.parse(value) },
    },
  }
}

type ParseRules = NonNullable<ReturnType<NonNullable<NodeConfig['parseHTML']>>>

export function chartBlockParseRules(): ParseRules {
  return [
    {
      tag: CHART_FIGURE_SELECTOR,
      priority: 60,
      getAttrs: element => {
        if (typeof element === 'string') return false
        const figure = readChartFigure(element)
        return figure ? { spec: figure.spec } : false
      },
    },
    // 外部 HTML 中带图表围栏语言的 <pre><code>：与 Markdown 导入同一准入，合法才成为图表。
    {
      tag: 'pre',
      priority: 61,
      getAttrs: element => {
        if (typeof element === 'string') return false
        const code = element.querySelector('code')
        const language = code?.className.match(/language-(\S+)/)?.[1]
        if (!code || !isMarkdownChartFenceLanguage(language)) return false
        const admission = admitMarkdownChartFenceBody(code.textContent ?? '')
        if (!admission.ok) throw new MarkdownChartSpecInvalidError(admission.diagnostics)
        return { spec: admission.spec }
      },
    },
  ]
}

export const renderChartBlockHtml: NonNullable<NodeConfig['renderHTML']> = ({ node, HTMLAttributes }) => {
  const spec = MarkdownChartSpecSchema.parse(node.attrs['spec'])
  const [tag, attributes, ...children] = chartFigureDomSpec(spec, {
    id: typeof node.attrs['id'] === 'string' ? node.attrs['id'] : null,
  })
  return [tag, mergeAttributes(HTMLAttributes, attributes), ...children]
}

/** Tiptap renderText 合同供查找/无障碍读取；图表仍是原子节点，文字不能通过行内替换写回。 */
export const renderChartBlockText: NonNullable<NodeConfig['renderText']> = ({ node }) => {
  const spec = MarkdownChartSpecSchema.parse(node.attrs['spec'])
  return [spec.title, spec.description, ...spec.categories, ...(spec.chartType === 'scatter' ? spec.pointLabels ?? [] : []), ...spec.series.map(series => series.name)]
    .filter(value => value !== undefined).join('\n')
}

/** 未挂载图表先预留绘图区和文字空间；宽度相关的自然换行仍由后续真实测量收敛。 */
export function estimateChartBlockHeight(node: ProseMirrorNode): number {
  const spec = MarkdownChartSpecSchema.parse(node.attrs['spec'])
  const legendItems = spec.chartType === 'pie' || spec.chartType === 'doughnut' ? spec.categories.length : spec.series.length
  return plotHeightOf(spec) + 32 + (spec.title ? Math.ceil(spec.title.length / 36) * 22 + 8 : 0)
    + (spec.description ? Math.ceil(spec.description.length / 48) * 20 : 0)
    + (resolveLegendPosition(spec) === 'none' ? 0 : Math.ceil(legendItems / 4) * 28)
    + (spec.chartType === 'radar' ? 24 : 0)
}
