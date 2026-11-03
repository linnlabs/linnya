import type { DocumentReferenceInput } from '@app/schemas';
import type { CanvasContentNode, CanvasElement } from '../../../../shared';

export function collectCanvasReferences(elements: readonly CanvasElement[]): DocumentReferenceInput[] {
  const references: DocumentReferenceInput[] = [];
  const visit = (node: CanvasContentNode): void => {
    if (node.type === 'documentReference') {
      const targetDocumentId = node.attrs?.documentId;
      const referenceId = node.attrs?.referenceId;
      if (typeof targetDocumentId !== 'string' || typeof referenceId !== 'string') throw new Error('文档标签缺少稳定身份');
      references.push({ targetDocumentId, referenceId, kind: 'inline-document' });
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const element of elements) {
    if (element.type === 'document') references.push({ targetDocumentId: element.data.documentId, referenceId: `card:${element.id}`, kind: 'document-card' });
    if (element.type === 'text') visit(element.data.content);
  }
  return references;
}
