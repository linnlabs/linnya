import { JsonValueSchema } from '@app/schemas';
import { serializeMarkdownDocument } from '@linnya/markdown-document-core';
import type { CanvasCard, CanvasContentNode, CanvasElement } from '../../../../shared';
import type { CanvasProjectionContext } from '../definitions/canvasProjection';

function projectReferenceNodes(node: CanvasContentNode, paths: ReadonlyMap<string, string>): CanvasContentNode {
  if (node.type === 'documentReference') {
    const documentId = node.attrs?.documentId;
    const path = typeof documentId === 'string' ? paths.get(documentId) : undefined;
    return path
      ? { type: 'text', text: path, marks: [{ type: 'link', attrs: { href: path } }] }
      : { type: 'text', text: '〔文档当前不可访问〕' };
  }
  return { ...node, ...(node.content ? { content: node.content.map(child => projectReferenceNodes(child, paths)) } : {}) };
}

export function projectCanvasCardBody(card: CanvasCard, context: CanvasProjectionContext): string {
  switch (card.type) {
    case 'text': return serializeMarkdownDocument(JsonValueSchema.parse(projectReferenceNodes(card.data.content, context.documentPaths)));
    case 'document': return context.documentPaths.get(card.data.documentId) ?? '〔文档当前不可访问〕';
    case 'image': return `图片：${card.data.caption || card.data.alt || '未命名图片'}`;
  }
}

export function listCanvasContentReferencedDocuments(content: CanvasContentNode): string[] {
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode): void => {
    if (node.type === 'documentReference' && typeof node.attrs?.documentId === 'string') ids.add(node.attrs.documentId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return [...ids];
}
export function listCanvasReferencedDocuments(elements: readonly CanvasElement[]): string[] {
  return [...new Set(elements.flatMap(element => element.type === 'document' ? [element.data.documentId] : element.type === 'text' ? listCanvasContentReferencedDocuments(element.data.content) : []))];
}
