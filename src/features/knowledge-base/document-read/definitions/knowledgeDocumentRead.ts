import type { KnowledgeSearchCitationMetadata } from '@app/schemas';
import type { Block } from '../../domain/block';
import type { KnowledgeBaseService } from '../../application/knowledgeBaseService';
import type { CitationRefAllocatorPort } from '../../../../domains/citation';

export type KnowledgeDocumentReadMode = 'full' | 'glance';

export interface KnowledgeDocumentReadRequest {
  readonly documentId: string;
  readonly startChunk: number;
  readonly endChunk: number;
  readonly mode: KnowledgeDocumentReadMode;
  readonly citationOffset: number;
}

export interface KnowledgeDocumentReadDependencies {
  readonly reader: Pick<KnowledgeBaseService, 'getDocumentById' | 'getRawSoTDocument'>;
  readonly assertDocumentAllowed: (knowledgeBaseId: string, documentId: string) => void;
  readonly citationRefAllocator: CitationRefAllocatorPort;
}

export interface OrderedKnowledgeDocumentBlock {
  readonly blockId: string;
  readonly block: Block;
}

export interface KnowledgeDocumentReadChunk {
  readonly index: number;
  readonly text: string;
}

export interface KnowledgeDocumentReadResult {
  readonly data: {
    readonly chunks: readonly KnowledgeDocumentReadChunk[];
    readonly filename: string;
    readonly total_chunks: number;
    readonly start_chunk: number;
    readonly end_chunk: number;
    readonly mode: KnowledgeDocumentReadMode;
    readonly has_more: boolean;
    readonly next_start_chunk: number | null;
    readonly citations: KnowledgeSearchCitationMetadata;
  };
  readonly observation: string;
  readonly observationPreviewMeta: {
    readonly filename: string;
  };
}
