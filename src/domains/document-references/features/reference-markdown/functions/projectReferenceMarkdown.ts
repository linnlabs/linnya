import { InlineDocumentReferenceAttrsSchema, type DocumentReferenceMarkdownBinding, type JsonValue } from '@app/schemas';
import type { ReferenceMarkdownBaseline, ReferenceMarkdownPort } from '../definitions/referenceMarkdown';
import { ReferenceMarkdownError } from '../definitions/referenceMarkdown';
import { encodedReferencePath, referenceChildren, referenceObject } from './referenceContent';

export function projectReferenceMarkdown(input: { readonly sourceDocumentId: string; readonly content: JsonValue }, port: ReferenceMarkdownPort): { content: JsonValue; baseline: ReferenceMarkdownBaseline } {
  const source = port.read(input.sourceDocumentId);
  if (!source || source.deletedAt !== null || !source.projectId) throw new ReferenceMarkdownError('reference_source_unavailable');
  const projectId = source.projectId;
  const bindings: DocumentReferenceMarkdownBinding[] = []; const unprojectableReferenceIds: string[] = [];
  function project(value: JsonValue): JsonValue {
    const node = referenceObject(value); if (!node) return value;
    if (node.type === 'documentReference') {
      const attrs = InlineDocumentReferenceAttrsSchema.parse(node.attrs); const target = port.read(attrs.documentId); const location = port.location(attrs.documentId);
      if (!target || target.deletedAt !== null || target.projectId !== projectId || !location) { unprojectableReferenceIds.push(attrs.referenceId); return { type: 'text', text: '〔文档当前不可访问〕' }; }
      bindings.push({ referenceId: attrs.referenceId, targetDocumentId: target.id, path: location.path, label: target.name });
      const marks = Array.isArray(node.marks) ? node.marks.filter(mark => referenceObject(mark)?.type !== 'link') : [];
      return { type: 'text', text: target.name, marks: [...marks, { type: 'link', attrs: { href: encodedReferencePath(location.path) } }] };
    }
    const children = referenceChildren(node); return children ? { ...node, content: children.map(project) } : node;
  }
  return { content: project(input.content), baseline: { bindings, unprojectableReferenceIds } };
}
export function assertReferenceMarkdownBindings(sourceDocumentId: string, bindings: readonly DocumentReferenceMarkdownBinding[], port: ReferenceMarkdownPort): void {
  const source = port.read(sourceDocumentId);
  if (!source || source.deletedAt !== null || !source.projectId) throw new ReferenceMarkdownError('reference_source_unavailable');
  for (const binding of bindings) {
    const target = port.read(binding.targetDocumentId); const location = port.location(binding.targetDocumentId); const resolved = port.resolvePath(source.projectId, binding.path);
    if (!target || target.deletedAt !== null || target.projectId !== source.projectId || location?.path !== binding.path || resolved?.id !== binding.targetDocumentId) throw new ReferenceMarkdownError('reference_path_changed');
  }
}
