import type { KnowledgeReadArgs } from '@app/schemas';
import type { ToolContext } from '../../types';
import type { KnowledgeDocumentReadResult } from '../../../features/knowledge-base/document-read/definitions/knowledgeDocumentRead';
import { readKnowledgeDocumentByChunks } from '../../../features/knowledge-base/document-read/orchestration/readKnowledgeDocumentByChunks';
import {
  assertDocumentKbAllowedInScope,
  resolveKnowledgeBaseScopeFromContext,
} from '../scope/projectKnowledgeBaseScope';
import {
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
} from '../../../domains/citation';

export async function readKnowledgeDocumentForTool(
  args: KnowledgeReadArgs,
  context: ToolContext
): Promise<KnowledgeDocumentReadResult> {
  const knowledgeBaseService = context.knowledgeBaseService;
  if (!knowledgeBaseService) {
    throw new Error('Knowledge base service not available in context');
  }
  try {
    const scope = resolveKnowledgeBaseScopeFromContext(context);
    return await readKnowledgeDocumentByChunks(
      {
        documentId: args.doc_id,
        startChunk: args.start_chunk,
        endChunk: args.end_chunk,
        mode: args.mode,
        citationOffset: requireCitationSequenceOffset(context),
      },
      {
        reader: knowledgeBaseService,
        assertDocumentAllowed: (knowledgeBaseId, documentId) => {
          assertDocumentKbAllowedInScope(scope, knowledgeBaseId, documentId);
        },
        citationRefAllocator: requireCitationRefAllocator(context),
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to browse document by chunk: ${message}`);
  }
}
