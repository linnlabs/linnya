/**
 * rootBlockRenderMode.ts
 *
 * RootBlock 渲染虚拟化的 mode 解析层。
 *
 * 中文说明：
 * - ProseMirror NodeView 的 hydrate / placeholder 切换必须通过官方 update=false 重建契约完成；
 * - NodeView 层只读取 decoration 上的轻量 mode，不直接依赖滚动、store 或 revision 业务；
 * - 当前模块是 R1 前置基础能力，真正的窗口调度插件会在后续切片接入。
 */

import { ROOT_BLOCK_DOM_ATTRS } from '../../../shared/rootBlockDomContract'

export type RootBlockRenderMode = 'hydrated' | 'placeholder'

export const ROOT_BLOCK_RENDER_MODE_SPEC_KEY = 'rootBlockRenderMode'
export const ROOT_BLOCK_RENDER_MODE_DATA_ATTR = ROOT_BLOCK_DOM_ATTRS.renderMode

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function normalizeRootBlockRenderMode(value: unknown): RootBlockRenderMode | null {
  if (value === 'hydrated' || value === 'placeholder') {
    return value
  }
  return null
}

function readModeFromDecorationSpec(decoration: unknown): RootBlockRenderMode | null {
  if (!isRecord(decoration)) return null

  const spec = decoration.spec
  if (!isRecord(spec)) return null

  return (
    normalizeRootBlockRenderMode(spec[ROOT_BLOCK_RENDER_MODE_SPEC_KEY]) ||
    normalizeRootBlockRenderMode(spec.mode)
  )
}

function readModeFromDecorationAttrs(decoration: unknown): RootBlockRenderMode | null {
  if (!isRecord(decoration)) return null

  const attrs = decoration.type
  if (!isRecord(attrs)) return null

  const decorationAttrs = attrs.attrs
  if (!isRecord(decorationAttrs)) return null

  return normalizeRootBlockRenderMode(decorationAttrs[ROOT_BLOCK_RENDER_MODE_DATA_ATTR])
}

/**
 * 从 ProseMirror 传入 NodeView.update 的 outer decorations 中读取 rootBlock 渲染模式。
 *
 * 默认返回 hydrated，确保 feature flag 未接入、插件未启用、或 decoration 缺失时仍保持现有行为。
 */
export function readExplicitRootBlockRenderModeFromDecorations(
  decorations: readonly unknown[] | undefined
): RootBlockRenderMode | null {
  if (!decorations || decorations.length === 0) return null

  for (const decoration of decorations) {
    const mode = readModeFromDecorationSpec(decoration) || readModeFromDecorationAttrs(decoration)
    if (mode) return mode
  }

  return null
}

export function readRootBlockRenderModeFromDecorations(
  decorations: readonly unknown[] | undefined
): RootBlockRenderMode {
  return readExplicitRootBlockRenderModeFromDecorations(decorations) ?? 'hydrated'
}

export function isPlaceholderRootBlockRenderMode(
  decorations: readonly unknown[] | undefined
): boolean {
  return readRootBlockRenderModeFromDecorations(decorations) === 'placeholder'
}
