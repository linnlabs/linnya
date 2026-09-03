/**
 * renderWindowState.ts
 *
 * RootBlock 虚拟化窗口从 ProseMirror doc/plugin state 派生数据的工具。
 */

import type { EditorState } from 'prosemirror-state'
import {
  getRenderVirtualizationState,
  type RenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { collectRootBlockIdsFromState } from '../functions/collectRootBlockIds'

const PERF_BLOCK_ID_SAMPLE_LIMIT = 12

export function collectRootBlockIds(state: EditorState): readonly string[] {
  return collectRootBlockIdsFromState(state)
}

export function collectHydratedLikeBlockIds(
  virtualizationState: RenderVirtualizationState | null
): Set<string> {
  const result = new Set<string>()
  if (!virtualizationState?.enabled) return result

  virtualizationState.hydratedSet.forEach((blockId) => result.add(blockId))
  virtualizationState.pinnedSet.forEach((blockId) => result.add(blockId))
  return result
}

export function collectDehydratableBlockIds(
  virtualizationState: RenderVirtualizationState | null
): Set<string> {
  const result = new Set<string>()
  if (!virtualizationState?.enabled) return result

  virtualizationState.hydratedSet.forEach((blockId) => {
    if (virtualizationState.pinnedSet.has(blockId)) return
    result.add(blockId)
  })
  return result
}

export function readActualHydratedWindowBlockIds(
  state: EditorState,
  visibleBlockIds: readonly string[]
): string[] {
  const virtualizationState = getRenderVirtualizationState(state)
  if (!virtualizationState?.enabled) return []

  return visibleBlockIds.filter((blockId) => (
    virtualizationState.hydratedSet.has(blockId) ||
    virtualizationState.pinnedSet.has(blockId)
  ))
}

export function sampleBlockIds(blockIds: readonly string[]): string[] {
  return blockIds.slice(0, PERF_BLOCK_ID_SAMPLE_LIMIT)
}
