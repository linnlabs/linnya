import { JsonValueSchema } from '@app/schemas';
import type { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { CanvasTextDocumentSchema, type CanvasSnapshot } from '../../shared';

/** 读基线由可信run登记；该临时投影不写回当前正文或用户历史。 */
export function projectCanvasCliSnapshot(snapshot: CanvasSnapshot, references: ReturnType<typeof createDocumentReferenceMarkdownRuntime>, readerId: string): CanvasSnapshot {
  return { ...snapshot, elements: snapshot.elements.map(element => element.type !== 'text' ? element : ({ ...element, data: { ...element.data,
    content: CanvasTextDocumentSchema.parse(references.registerRead({ readerId, sourceDocumentId: snapshot.documentId,
      sourceKey: `${element.id}:${element.revision}`, content: JsonValueSchema.parse(element.data.content) }).content),
  } })) };
}
