import type { CitationSourceType } from '@app/schemas'

/** Pending/Markdown 边界接纳后的引用来源快照。 */
export interface CitationHydrationData {
  docId?: string
  blockId?: string
  title: string
  snippet: string
  kbId?: string
  sourceType?: CitationSourceType
  url?: string
  date?: string
  authors?: string[]
  containerTitle?: string
}
