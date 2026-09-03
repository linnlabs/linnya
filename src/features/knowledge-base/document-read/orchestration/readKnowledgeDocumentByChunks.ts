import type { Block } from '../../domain/block';
import type {
  KnowledgeDocumentReadDependencies,
  KnowledgeDocumentReadRequest,
  KnowledgeDocumentReadResult,
  OrderedKnowledgeDocumentBlock,
} from '../definitions/knowledgeDocumentRead';
import {
  buildKnowledgeDocumentReadResult,
  selectKnowledgeDocumentReadBlocks,
} from '../functions/buildKnowledgeDocumentReadResult';

export async function readKnowledgeDocumentByChunks(
  request: KnowledgeDocumentReadRequest,
  dependencies: KnowledgeDocumentReadDependencies
): Promise<KnowledgeDocumentReadResult> {
  const document = await dependencies.reader.getDocumentById(request.documentId);
  if (!document) {
    throw new Error(`Document with ID '${request.documentId}' not found.`);
  }

  dependencies.assertDocumentAllowed(document.kbId, request.documentId);
  const sourceOfTruth = await dependencies.reader.getRawSoTDocument(request.documentId);
  if (!sourceOfTruth?.content_blocks) {
    throw new Error(`Document with ID '${request.documentId}' has no content blocks.`);
  }

  // content_blocks 是映射；文档原始顺序只能以摄入时写入的 structure.root 为准。
  const rootBlockIds = Array.isArray(sourceOfTruth.structure?.root)
    ? sourceOfTruth.structure.root.filter((id): id is string => typeof id === 'string')
    : [];
  const orderedBlocks: OrderedKnowledgeDocumentBlock[] = rootBlockIds
    .map(blockId => ({ blockId, block: sourceOfTruth.content_blocks[blockId] }))
    .filter(
      (entry): entry is { blockId: string; block: Block } =>
        typeof entry.block === 'object' && entry.block !== null
    );

  const selection = selectKnowledgeDocumentReadBlocks({ request, orderedBlocks });
  const citationRefs = await dependencies.citationRefAllocator.allocate(
    selection.selectedEntries.map(entry => ({
      sourceType: 'knowledge_base' as const,
      docId: request.documentId,
      blockId: entry.blockId,
    }))
  );
  return buildKnowledgeDocumentReadResult({
    filename: document.filename,
    selection,
    citationRefs,
  });
}
