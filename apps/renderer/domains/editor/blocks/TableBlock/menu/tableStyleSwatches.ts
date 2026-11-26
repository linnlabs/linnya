/**
 * 表格样式缩略图：块菜单“表格样式”子菜单里每一项左侧的 24×18 示意。
 * 同一网格（表头 1–5.5，行线 5.5 / 9.5 / 13.5 / 17.5，列线 8.5 / 16.5），只画该样式的线与底色；
 * 颜色跟随所在选项的文字色，选中项随之变成强调色。
 */

import { defineComponent, h, type Component, type VNode } from 'vue'
import type { WorkspaceTableStyle } from '@linnya/markdown-document-core/workspace-table'

const rule = (y: number, opacity: number, width = 1): VNode =>
  h('path', { d: `M0 ${y}H24`, stroke: 'currentColor', 'stroke-opacity': opacity, 'stroke-width': width })
const column = (x: number, opacity: number): VNode =>
  h('path', { d: `M${x} 1V18`, stroke: 'currentColor', 'stroke-opacity': opacity })
const headerWash = (opacity: number, fill = 'currentColor'): VNode =>
  h('rect', { x: 0, y: 1, width: 24, height: 4.5, style: { fill }, 'fill-opacity': opacity })
const rowRules = (opacity: number): VNode[] => [rule(9.5, opacity), rule(13.5, opacity), rule(17.5, opacity)]

const SWATCH_PARTS: Readonly<Record<WorkspaceTableStyle, () => VNode[]>> = {
  default: () => [headerWash(0.12), rule(5.5, 0.6), ...rowRules(0.28)],
  'three-line': () => [rule(1, 0.85, 1.5), rule(5.5, 0.7), rule(17.25, 0.85, 1.5)],
  'column-rules': () => [headerWash(0.12), rule(5.5, 0.6), ...rowRules(0.28), column(8.5, 0.28), column(16.5, 0.28)],
  grid: () => [
    headerWash(0.12),
    h('rect', { x: 0.5, y: 1.5, width: 23, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.32 }),
    rule(5.5, 0.6), rule(9.5, 0.32), rule(13.5, 0.32), column(8.5, 0.32), column(16.5, 0.32),
  ],
  banded: () => [rule(5.5, 0.6), h('rect', { x: 0, y: 9.5, width: 24, height: 4, style: { fill: 'currentColor' }, 'fill-opacity': 0.13 })],
  'accent-header': () => [headerWash(0.4, 'var(--color-accent)'), ...rowRules(0.28)],
}

function createSwatch(style: WorkspaceTableStyle): Component {
  return defineComponent({
    name: `TableStyleSwatch-${style}`,
    render: () => h('svg', {
      viewBox: '0 0 24 18',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      'data-table-style-swatch': style,
    }, SWATCH_PARTS[style]()),
  })
}

export const TABLE_STYLE_SWATCHES: Readonly<Record<WorkspaceTableStyle, Component>> = Object.freeze(
  Object.fromEntries(Object.keys(SWATCH_PARTS).map(style => [style, createSwatch(style as WorkspaceTableStyle)])) as Record<WorkspaceTableStyle, Component>,
)
