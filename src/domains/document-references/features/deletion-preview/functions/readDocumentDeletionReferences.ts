import { z } from 'zod';
import type { DocumentReferenceDeletionPreview } from '@app/schemas';
import type { ReferenceDatabase, ReferenceNodePort, ReferenceNode } from '../../../definitions/documentReferences';
const rowsSchema = z.array(z.object({ source_document_id: z.string(), target_document_id: z.string(), reference_count: z.number().int().positive() }));
const VISIBLE_DOCUMENT_LIMIT = 10;
/** 聚合关系后读取节点身份，多个卡引用同文档不会反复查询同一个来源。 */
export function readDocumentDeletionReferences(db: Pick<ReferenceDatabase, 'prepare'>, deletingNodeIds: readonly string[], nodes: ReferenceNodePort): DocumentReferenceDeletionPreview {
  const deleting = new Set(deletingNodeIds);
  const rows = rowsSchema.parse(db.prepare(`SELECT source_document_id, target_document_id, COUNT(*) AS reference_count FROM document_references WHERE target_document_id IN (SELECT value FROM json_each(?)) GROUP BY source_document_id, target_document_id`).all(JSON.stringify(deletingNodeIds)));
  const cache = new Map<string, ReferenceNode | null>();
  function read(id: string) { if (!cache.has(id)) cache.set(id, nodes.read(id)); return cache.get(id); }
  const documents = new Map<string, { sourceDocumentId: string; title: string; nodeType: string; referenceCount: number }>();
  let referenceCount = 0;
  for (const row of rows) {
    if (deleting.has(row.source_document_id)) continue;
    const source = read(row.source_document_id), target = read(row.target_document_id);
    if (!source || !target || source.deletedAt !== null || target.deletedAt !== null || !target.projectId || source.projectId !== target.projectId) continue;
    referenceCount += row.reference_count;
    const previous = documents.get(source.id);
    documents.set(source.id, { sourceDocumentId: source.id, title: source.name, nodeType: source.nodeType, referenceCount: (previous?.referenceCount ?? 0) + row.reference_count });
  }
  return { referenceCount, referencingDocumentCount: documents.size, documents: [...documents.values()].sort((left, right) => left.title.localeCompare(right.title)).slice(0, VISIBLE_DOCUMENT_LIMIT) };
}
