import {
  DocumentBacklinksRequestSchema,
  type DocumentBacklinksPage,
  type DocumentBacklinkSource,
} from '@app/schemas';
import type { BacklinkQueryPort } from '../definitions/backlinkQuery';

export function readDocumentBacklinks(
  input: unknown,
  port: BacklinkQueryPort
): DocumentBacklinksPage {
  const request = DocumentBacklinksRequestSchema.parse(input);
  const target = port.read(request.documentId);
  // 请求的项目是当前导航范围；不允许借稳定ID读取另一项目的来源信息。
  const references =
    target?.projectId === request.projectId && target.deletedAt === null
      ? port.listBacklinks(request.documentId)
      : [];
  const grouped = new Map<string, DocumentBacklinkSource>();
  for (const reference of references) {
    const previous = grouped.get(reference.sourceDocumentId);
    grouped.set(reference.sourceDocumentId, {
      sourceDocumentId: reference.sourceDocumentId,
      title: reference.sourceTitle,
      nodeType: reference.sourceNodeType,
      referenceCount: (previous?.referenceCount ?? 0) + 1,
    });
  }
  const documents = [...grouped.values()];
  const end = request.offset + request.limit;
  return {
    referenceCount: references.length,
    documentCount: documents.length,
    documents: documents.slice(request.offset, end),
    nextOffset: end < documents.length ? end : null,
  };
}
