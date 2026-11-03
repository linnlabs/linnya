import { DocumentReferenceMarkdownBindingSchema, InlineDocumentReferenceAttrsSchema, JsonValueSchema, type DocumentReferenceInput, type DocumentReferenceMarkdownBinding, type JsonValue } from '@app/schemas';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';
import { importMarkdownToDocJsonSync, validateMarkdownDocJson, parseMarkdownDocJson, attachCitationNodesToDocJson } from '../../normalization/runtime';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared';
import { parsePendingMetadata, extractPendingCitationHydration, extractPendingCitationLinkHydration } from '../../pending-revisions';
import type { MarkdownDocumentReferencesPort } from '../definitions/markdownDocumentReferences';

export function collectMarkdownDocumentReferences(content: unknown): DocumentReferenceInput[] {
  const refs: DocumentReferenceInput[] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if ('type' in value && value.type === 'documentReference' && 'attrs' in value) {
      const attrs = InlineDocumentReferenceAttrsSchema.parse(value.attrs); refs.push({ referenceId: attrs.referenceId, targetDocumentId: attrs.documentId, kind: 'inline' });
    }
    if ('content' in value && Array.isArray(value.content)) for (const child of value.content) visit(child);
  }
  visit(content); return refs;
}
export function assertMarkdownDocumentReferenceIdentities(content: unknown): void {
  const references = collectMarkdownDocumentReferences(content);
  if (new Set(references.map(reference => reference.referenceId)).size !== references.length) throw new Error('Document reference appearance IDs must be unique within a document.');
}
export function readPendingDocumentReferenceBindings(metadata: unknown): DocumentReferenceMarkdownBinding[] {
  if (!metadata || typeof metadata !== 'object' || !('document_reference_bindings' in metadata)) return [];
  const value = metadata.document_reference_bindings;
  if (!Array.isArray(value)) throw new Error('Pending document reference bindings must be an array.');
  return value.map(binding => DocumentReferenceMarkdownBindingSchema.parse(binding));
}
export function pendingDocumentReferenceBindings(pendings: readonly MarkdownPendingRevisionLike[]): DocumentReferenceMarkdownBinding[] {
  return pendings.flatMap(pending => readPendingDocumentReferenceBindings(pending.meta_json ? JSON.parse(pending.meta_json) : null));
}
export function referenceBaselineContent(content: unknown, pendings: readonly MarkdownPendingRevisionLike[]): JsonValue {
  return { type: 'doc', content: [JsonValueSchema.parse(content), ...pendingDocumentReferenceBindings(pendings).map(binding => ({ type: 'documentReference', attrs: { referenceId: binding.referenceId, documentId: binding.targetDocumentId } }))] };
}
export function projectMarkdownReferenceContent(port: MarkdownDocumentReferencesPort | undefined, documentId: string, content: unknown) {
  if (!collectMarkdownDocumentReferences(content).length) return { content: validateMarkdownDocJson(parseMarkdownDocJson(content)), bindings: [], unprojectableReferenceIds: [] };
  if (!port) throw new Error('Markdown document reference port is not bound to this database.');
  const projected = port.project({ sourceDocumentId: documentId, content: JsonValueSchema.parse(content) });
  return { ...projected, content: validateMarkdownDocJson(parseMarkdownDocJson(projected.content)) };
}
export function hydratePendingDocumentReferences(port: MarkdownDocumentReferencesPort | undefined, content: unknown, metadata: unknown) {
  const bindings = readPendingDocumentReferenceBindings(metadata);
  if (!bindings.length) return validateMarkdownDocJson(parseMarkdownDocJson(content));
  if (!port) throw new Error('Markdown document reference port is not bound to this database.');
  return validateMarkdownDocJson(parseMarkdownDocJson(port.hydrate({ content: JsonValueSchema.parse(content), bindings })));
}

/** Pending 只存 Markdown + 绑定身份，读时经相同 parser 恢复后投影当前标题和路径。 */
export function projectMarkdownReferencePendings(port: MarkdownDocumentReferencesPort | undefined, documentId: string, pendings: readonly MarkdownPendingRevisionLike[]): readonly MarkdownPendingRevisionLike[] {
  return pendings.map(pending => {
    const metadata = parsePendingMetadata(pending.meta_json);
    const bindings = readPendingDocumentReferenceBindings(metadata);
    if (!bindings.length || !pending.new_markdown?.trim()) return pending;
    if (!port) throw new Error('Markdown document reference port is not bound to this database.');
    const parsed = importMarkdownToDocJsonSync(pending.new_markdown).docJson;
    if (!parsed) throw new Error('Pending document reference Markdown has no parsed content.');
    const canonical = hydratePendingDocumentReferences(port, parsed, metadata);
    const projected = projectMarkdownReferenceContent(port, documentId, canonical).content;
    const citations = attachCitationNodesToDocJson(projected, extractPendingCitationHydration(metadata, pending.target_block_id) ?? {}, extractPendingCitationLinkHydration(metadata, pending.target_block_id) ?? {});
    const blocks = flattenMarkdownDocumentBlocks(citations, { includeAnnotations: false, projectInlineNode: node => node.type === 'citationNode' && typeof node.attrs['ref'] === 'string' ? `[@${node.attrs['ref']}]` : null });
    return { ...pending, new_markdown: serializeMarkdownBlocks(blocks) };
  });
}
export function buildMarkdownReferenceReadProjection(port: MarkdownDocumentReferencesPort | undefined, documentId: string, content: unknown, pendings: readonly MarkdownPendingRevisionLike[]) {
  const projected = projectMarkdownReferenceContent(port, documentId, content);
  const pending = pendingDocumentReferenceBindings(pendings);
  const all = port && pending.length ? port.project({ sourceDocumentId: documentId, content: referenceBaselineContent(content, pendings) }) : projected;
  const bindings = [...new Map([...all.bindings, ...pending].map(binding => [JSON.stringify(binding), binding])).values()];
  return { content: projected.content, pendings: projectMarkdownReferencePendings(port, documentId, pendings), bindings, unprojectableReferenceIds: all.unprojectableReferenceIds };
}
