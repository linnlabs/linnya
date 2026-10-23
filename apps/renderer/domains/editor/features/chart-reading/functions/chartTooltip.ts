/**
 * @file chartTooltip.ts
 * @description tooltip 内容模型与 DOM 渲染。
 *
 * 系列名、类目名与标题都是不可信文本，只通过 `textContent` 写入，绝不拼接 HTML。
 * 内容模型是纯数据，因此“tooltip 读到的是正式观测值”可以直接断言，而不依赖绘图库。
 * 外观是反色（深底浅字；深色主题里浅底深字），与界面里的反色 token 一致；次要文字是同一文字色的透明度。
 */

import type { ChartThemeTokens } from '../definitions/chartTheme'
import { withAlpha } from './chartPalette'

export type ChartTooltipKeyShape = 'bar' | 'line' | 'dot'

export interface ChartTooltipRow {
  /** 填充与描线：条形/圆点键用填充 + 描线轮廓，线键用描线色。 */
  readonly key: { readonly fill: string; readonly ink: string; readonly shape: ChartTooltipKeyShape }
  readonly label: string
  readonly value: string
  /** 值之后的补充说明，例如“占整体 38%”。 */
  readonly detail?: string
}

export interface ChartTooltipContent {
  readonly heading?: string
  readonly rows: readonly ChartTooltipRow[]
}

function text(doc: Document, tag: string, content: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const element = doc.createElement(tag)
  element.textContent = content
  Object.assign(element.style, style)
  return element
}

function keyElement(doc: Document, key: ChartTooltipRow['key']): HTMLElement {
  const element = doc.createElement('span')
  const shape: Record<ChartTooltipKeyShape, Partial<CSSStyleDeclaration>> = {
    bar: { width: '10px', height: '10px', borderRadius: '2px' },
    line: { width: '12px', height: '3px', borderRadius: '2px' },
    dot: { width: '8px', height: '8px', borderRadius: '50%' },
  }
  const appearance: Partial<CSSStyleDeclaration> = key.shape === 'line'
    ? { background: key.ink }
    : { background: key.fill, border: `1px solid ${key.ink}`, boxSizing: 'border-box' }
  Object.assign(element.style, { display: 'inline-block', flex: '0 0 auto' }, shape[key.shape], appearance)
  element.setAttribute('aria-hidden', 'true')
  return element
}

/** 构建 tooltip 根节点；ECharts 以 `appendToBody` 方式承载它，因此样式全部内联。 */
export function renderChartTooltip(
  content: ChartTooltipContent,
  theme: ChartThemeTokens,
  ownerDocument: Document = document,
): HTMLElement {
  const root = ownerDocument.createElement('div')
  const secondary = withAlpha(theme.tooltipText, 0.72)
  const tertiary = withAlpha(theme.tooltipText, 0.56)
  Object.assign(root.style, {
    minWidth: '148px',
    maxWidth: '300px',
    padding: '9px 12px',
    borderRadius: '10px',
    background: theme.tooltipBackground,
    boxShadow: theme.scheme === 'dark' ? '0 6px 18px rgba(0,0,0,0.5)' : '0 6px 18px rgba(0,0,0,0.2)',
    font: `12px/1.5 ${theme.fontFamily}`,
    color: theme.tooltipText,
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)

  if (content.heading) {
    root.appendChild(text(ownerDocument, 'div', content.heading, {
      color: theme.tooltipText,
      fontWeight: '600',
      marginBottom: '4px',
    }))
  }

  for (const row of content.rows) {
    const line = ownerDocument.createElement('div')
    Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: '8px', lineHeight: '20px' })
    line.appendChild(keyElement(ownerDocument, row.key))
    line.appendChild(text(ownerDocument, 'span', row.label, {
      flex: '1 1 auto',
      minWidth: '0',
      color: secondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }))
    // 值居先：读者来 tooltip 是为了取数，系列名已由图例提供。
    line.appendChild(text(ownerDocument, 'span', row.value, {
      flex: '0 0 auto',
      color: theme.tooltipText,
      fontWeight: '600',
      fontVariantNumeric: 'tabular-nums',
      marginLeft: '12px',
    }))
    root.appendChild(line)
    if (row.detail) {
      root.appendChild(text(ownerDocument, 'div', row.detail, {
        color: tertiary,
        paddingLeft: '20px',
        lineHeight: '16px',
        marginBottom: '2px',
      }))
    }
  }
  return root
}
