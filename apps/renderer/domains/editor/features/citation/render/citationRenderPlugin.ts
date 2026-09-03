/**
 * Citation 派生读模型插件。
 *
 * CitationNode attrs 是唯一持久化真相；本插件只计算编号和参考文献条目，绝不修改正文。
 * 因此 direct-state 原子装载、undo/redo 和 pending projection 都不存在“等待下一笔事务才把
 * `[@ref]` 改成 `[1]`”的时序窗口。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  deriveCitations,
  getBibliographyStyleId,
  type CitationDerivationResult,
  type BibliographyEntry,
} from './citationDerivation'
import type { BibliographyStyleId } from '../types'

export const citationRenderPluginKey = new PluginKey<CitationRenderPluginState>(
  'citationRenderPlugin'
)

export interface CitationRenderPluginState {
  styleId: BibliographyStyleId
  derivation: CitationDerivationResult
}

function computePluginState(doc: ProseMirrorNode): CitationRenderPluginState {
  const styleId = getBibliographyStyleId(doc)
  return {
    styleId,
    derivation: deriveCitations(doc, styleId),
  }
}

export function createCitationRenderPlugin(): Plugin<CitationRenderPluginState> {
  return new Plugin<CitationRenderPluginState>({
    key: citationRenderPluginKey,
    state: {
      init(_, state: EditorState): CitationRenderPluginState {
        return computePluginState(state.doc)
      },
      apply(
        tr: Transaction,
        pluginState: CitationRenderPluginState,
        _oldState: EditorState,
        newState: EditorState
      ): CitationRenderPluginState {
        if (!tr.docChanged && !tr.getMeta('forceCitationDerivation')) return pluginState
        if (tr.getMeta('pendingRevisionApply')) return pluginState
        return computePluginState(newState.doc)
      },
    },
  })
}

export function getCitationDerivation(state: EditorState): CitationDerivationResult | null {
  return citationRenderPluginKey.getState(state)?.derivation ?? null
}

export function getBibliographyEntries(state: EditorState): BibliographyEntry[] {
  return getCitationDerivation(state)?.entries ?? []
}

export function getCurrentStyleId(state: EditorState): BibliographyStyleId {
  return citationRenderPluginKey.getState(state)?.styleId ?? 'numeric'
}

export function getLabelBySourceId(state: EditorState, sourceId: string): string | null {
  return getCitationDerivation(state)?.labelBySourceId.get(sourceId) ?? null
}
