import type { WasmBlockEvent } from '../../../../shared/services/markdownService'
import type {
  CitationInlineMeta,
  MarkName,
  TextSpan,
} from '../../features/Revision/protocol/revisionTextSpanTypes'

export type BlockEventLike = WasmBlockEvent

export type MarkLike = {
  type: string
  attrs?: Record<string, unknown> | null
}

export type ContentFragmentLike =
  | {
      type: 'text'
      text?: string | null
      marks?: MarkLike[] | null
    }
  | {
      type: 'inlineLatex'
      attrs?: Record<string, unknown> | null
    }
  | {
      type: 'hardBreak'
      marks?: MarkLike[] | null
    }
  | {
      type: 'citationNode'
      attrs?: Record<string, unknown> | null
      marks?: MarkLike[] | null
    }
  | {
      type: string
      text?: string | null
      marks?: MarkLike[] | null
      attrs?: Record<string, unknown> | null
    }

export type SupportedInlineMarkName = MarkName

export type MarkdownInlineFragment =
  | {
      type: 'text'
      text: string
      marks: MarkLike[]
    }
  | {
      type: 'hardBreak'
      marks: MarkLike[]
    }
  | {
      type: 'inlineLatex'
      attrs: Record<string, unknown>
      latexSource: string
      textRepresentation: string
    }
  | {
      type: 'citationNode'
      attrs: Record<string, unknown>
      citation: CitationInlineMeta
      marks: MarkLike[]
      textRepresentation: string
    }

export interface MarkdownInlineProjection {
  fragments: MarkdownInlineFragment[]
  spans: TextSpan[]
  plainText: string
  newlineMode: 'hardBreak'
  sourceBlockCount: number
  droppedBlockCount: number
}

export interface InlineProjectionDropInfo {
  requestedBlockCount: number
  usedBlockCount: number
  droppedBlockCount: number
}

export interface InlineProjectionOptions {
  multiBlockMode?: 'join-blocks' | 'first-block'
  blockSeparator?: string
  onDroppedBlocks?: (info: InlineProjectionDropInfo) => void
}
