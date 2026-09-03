import type { CitationNodeAttrs, CitationSourceType } from '../types'

function readOptionalString(attrs: Record<string, unknown>, key: string): string | undefined {
  const value = attrs[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readStringList(attrs: Record<string, unknown>, key: string): string[] | undefined {
  const value = attrs[key]
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    )
    return items.length > 0 ? items : undefined
  }
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const items = parsed.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    )
    return items.length > 0 ? items : undefined
  } catch {
    return undefined
  }
}

export function readCitationNodeAttrs(attrs: Record<string, unknown>): CitationNodeAttrs | null {
  const citationId = readOptionalString(attrs, 'citationId')
  const sourceId = readOptionalString(attrs, 'sourceId')
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const snippet = typeof attrs.snippet === 'string' ? attrs.snippet : ''
  if (!citationId || !sourceId) return null

  const rawSourceType = attrs.sourceType
  const sourceType: CitationSourceType =
    rawSourceType === 'knowledge_base' || rawSourceType === 'web' || rawSourceType === 'manual'
      ? rawSourceType
      : 'manual'

  return {
    citationId,
    ref: readOptionalString(attrs, 'ref'),
    sourceType,
    sourceId,
    kbId: readOptionalString(attrs, 'kbId'),
    blockId: readOptionalString(attrs, 'blockId'),
    title,
    snippet,
    snippets: readStringList(attrs, 'snippets'),
    authors: readStringList(attrs, 'authors'),
    date: readOptionalString(attrs, 'date'),
    url: readOptionalString(attrs, 'url'),
    containerTitle: readOptionalString(attrs, 'containerTitle'),
  }
}

/**
 * CitationNode 在 Markdown/HTML 边界上的稳定文本投影。
 * 数字编号属于当前文档的派生视图，绝不能持久化到交换协议。
 */
export function projectCitationNodeToPortableText(attrs: Record<string, unknown>): string {
  const ref = readOptionalString(attrs, 'ref')
  if (ref) return `[@${ref}]`
  return attrs.sourceType === 'manual' ? '【manual citation】' : '【invalid citation】'
}
