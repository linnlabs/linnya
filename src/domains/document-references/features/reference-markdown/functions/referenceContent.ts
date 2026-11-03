import { InlineDocumentReferenceAttrsSchema, type DocumentReferenceInput, type JsonValue } from '@app/schemas';

export type ReferenceJsonObject = { [key: string]: JsonValue };
export function referenceObject(value: JsonValue | undefined): ReferenceJsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}
export function referenceChildren(node: ReferenceJsonObject): JsonValue[] | null { return Array.isArray(node.content) ? node.content : null; }
export function collectDocumentReferenceInputs(content: JsonValue): DocumentReferenceInput[] {
  const result: DocumentReferenceInput[] = [];
  function visit(value: JsonValue): void {
    const node = referenceObject(value); if (!node) return;
    if (node.type === 'documentReference') { const attrs = InlineDocumentReferenceAttrsSchema.parse(node.attrs); result.push({ referenceId: attrs.referenceId, targetDocumentId: attrs.documentId, kind: 'inline' }); }
    for (const child of referenceChildren(node) ?? []) visit(child);
  }
  visit(content); return result;
}
export function workspaceReferenceHref(node: ReferenceJsonObject): string | null {
  if (!Array.isArray(node.marks)) return null;
  if (node.marks.some(mark => referenceObject(mark)?.type === 'code')) return null;
  for (const mark of node.marks) {
    const value = referenceObject(mark); const attrs = referenceObject(value?.attrs);
    if (value?.type === 'link' && typeof attrs?.href === 'string' && attrs.href.startsWith('workspace:')) return attrs.href;
  }
  return null;
}
export function normalizedReferencePath(href: string): string { return 'workspace:' + decodeURIComponent(href.slice('workspace:'.length)); }
export function encodedReferencePath(path: string): string { return 'workspace:' + path.slice('workspace:'.length).split('/').map(segment => encodeURIComponent(segment)).join('/'); }
export function commonReferenceMarks(nodes: readonly ReferenceJsonObject[]): JsonValue[] {
  const first = nodes[0]; const marks = Array.isArray(first?.marks) ? first.marks : [];
  return marks.filter(mark => referenceObject(mark)?.type !== 'link' && nodes.every(node => Array.isArray(node.marks) && node.marks.some(other => JSON.stringify(other) === JSON.stringify(mark))));
}
