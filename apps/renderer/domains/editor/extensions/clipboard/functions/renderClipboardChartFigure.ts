/**
 * @file renderClipboardChartFigure.ts
 * @description 块复制时把 `linnya-chart` 围栏渲染成 `<figure>`（规格 + 数据表），而不是一段难读的 JSON 代码。
 *
 * - 内部粘贴：`data-chart-spec` 经 ChartBlock 的解析规则走同一准入，得到等价图表；
 * - 外部应用：figure 内的标题与数据表是可读、可粘贴进电子表格的等价内容。
 *
 * 通过 markdown-it 的 `fence` 渲染规则接入，上下文由本次渲染的 `env` 携带，规则本身无全局状态。
 */

import type MarkdownIt from 'markdown-it'
import { admitMarkdownChartFenceBody, isMarkdownChartFenceLanguage } from '@app/schemas'
import { chartFigureHtml } from '../../../blocks/ChartBlock/html'
import { buildChartDataTable, type ChartDataTableLabels } from '../../../features/chart-reading'

const ENV_KEY = 'linnyaChartClipboard'

export interface ClipboardChartContext {
  readonly ownerDocument: Document
  readonly labels: ChartDataTableLabels
  readonly locale: string
}

/** 把图表渲染上下文放进一次 `md.render(value, env)` 的 env。 */
export function createClipboardChartEnv(context: ClipboardChartContext): Record<string, unknown> {
  return { [ENV_KEY]: context }
}

function isClipboardChartContext(value: unknown): value is ClipboardChartContext {
  return typeof value === 'object' && value !== null
    && 'ownerDocument' in value && 'labels' in value && 'locale' in value
}

function readContext(env: unknown): ClipboardChartContext | null {
  if (typeof env !== 'object' || env === null) return null
  const context: unknown = Reflect.get(env, ENV_KEY)
  return isClipboardChartContext(context) ? context : null
}

export function installClipboardChartFenceRule(md: MarkdownIt): void {
  const fallback = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const context = token ? readContext(env) : null
    const language = token?.info.trim().split(/\s+/)[0]
    if (token && context && isMarkdownChartFenceLanguage(language)) {
      const admission = admitMarkdownChartFenceBody(token.content)
      if (admission.ok) {
        const table = buildChartDataTable(admission.spec, context.labels, context.locale)
        return `${chartFigureHtml(context.ownerDocument, admission.spec, { table })}\n`
      }
    }
    return fallback ? fallback(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
  }
}
