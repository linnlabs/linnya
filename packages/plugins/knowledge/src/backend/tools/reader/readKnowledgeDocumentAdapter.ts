import { getKnowledgeToolRuntime } from '../runtime/knowledgeToolRuntime';
import type { KnowledgeReadArgs } from '@app/schemas';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import type { KnowledgeDocumentReadResult } from '../../document-read/definitions/knowledgeDocumentRead';
import { readKnowledgeDocumentByChunks } from '../../document-read/orchestration/readKnowledgeDocumentByChunks';
import {
  assertDocumentKbAllowedInScope,
  resolveKnowledgeBaseScopeFromContext,
} from '../scope/projectKnowledgeBaseScope';
import {
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
} from '@plugin/backend/citationSourceRuntime';

export async function readKnowledgeDocumentForTool(
  args: KnowledgeReadArgs,
  context: ToolContext
): Promise<KnowledgeDocumentReadResult> {
  const knowledgeBaseService = getKnowledgeToolRuntime().service;
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
