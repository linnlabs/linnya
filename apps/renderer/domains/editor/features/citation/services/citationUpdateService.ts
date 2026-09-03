/** CitationNode 查询与更新能力。业务规则留在纯函数/服务层，UI 只负责触发。 */
import type { Editor } from '@tiptap/vue-3'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { CitationNodeAttrs } from '../types'
import { readCitationNodeAttrs } from '../functions/citationNodeProjection'

export interface CitationSourceUpdateData {
  title: string
  authors?: string[]
  date?: string
  url?: string
  containerTitle?: string
}

export interface CitationPosition {
  pos: number
  node: ProseMirrorNode
  attrs: CitationNodeAttrs
}

function findCitationNodes(
  doc: ProseMirrorNode,
  matches: (attrs: CitationNodeAttrs) => boolean
): CitationPosition[] {
  const positions: CitationPosition[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'citationNode') return true
    const attrs = readCitationNodeAttrs(node.attrs)
    if (attrs && matches(attrs)) positions.push({ pos, node, attrs })
    return false
  })
  return positions
}

export function findCitationsBySourceId(
  doc: ProseMirrorNode,
  sourceId: string
): CitationPosition[] {
  return findCitationNodes(doc, attrs => attrs.sourceId === sourceId)
}

export function findCitationsByCitationId(
  doc: ProseMirrorNode,
  citationId: string
): CitationPosition[] {
  return findCitationNodes(doc, attrs => attrs.citationId === citationId)
}

export function countCitationsBySourceId(doc: ProseMirrorNode, sourceId: string): number {
  return findCitationsBySourceId(doc, sourceId).length
}

export function updateCitationsBySourceId(
  editor: Editor,
  sourceId: string,
  updateData: CitationSourceUpdateData
): number {
  const positions = findCitationsBySourceId(editor.state.doc, sourceId)
  if (positions.length === 0) return 0

  const tr = editor.state.tr
  for (const position of positions) {
    const attrs: Record<string, unknown> = {
      ...position.node.attrs,
      title: updateData.title,
      ...(updateData.authors !== undefined ? { authors: updateData.authors } : {}),
      ...(updateData.date !== undefined ? { date: updateData.date } : {}),
      ...(updateData.url !== undefined ? { url: updateData.url } : {}),
      ...(updateData.containerTitle !== undefined
        ? { containerTitle: updateData.containerTitle }
        : {}),
    }
    tr.setNodeMarkup(position.pos, undefined, attrs, position.node.marks)
  }
  editor.view.dispatch(tr)
  return positions.length
}

function readSnippets(attrs: Record<string, unknown>): string[] {
  const raw = attrs.snippets
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  return []
}

export function updateCitationSnippetByCitationId(
  editor: Editor,
  citationId: string,
  nextSnippet: string
): boolean {
  const positions = findCitationsByCitationId(editor.state.doc, citationId)
  if (positions.length === 0) return false

  const trimmed = nextSnippet.trim()
  const tr = editor.state.tr
  for (const position of positions) {
    const snippets = readSnippets(position.node.attrs)
    if (snippets.length > 0) {
      if (trimmed) snippets[0] = trimmed
      else snippets.shift()
    }
    tr.setNodeMarkup(
      position.pos,
      undefined,
      {
        ...position.node.attrs,
        snippet: snippets[0] ?? trimmed,
        snippets: snippets.length > 0 ? snippets : null,
      },
      position.node.marks
    )
  }
  editor.view.dispatch(tr)
  return true
}

export function getCitationByCitationId(
  doc: ProseMirrorNode,
  citationId: string
): CitationNodeAttrs | null {
  return findCitationsByCitationId(doc, citationId)[0]?.attrs ?? null
}

export const citationUpdateService = {
  findCitationsBySourceId,
  findCitationsByCitationId,
  countCitationsBySourceId,
  updateCitationsBySourceId,
  updateCitationSnippetByCitationId,
  getCitationByCitationId,
}
