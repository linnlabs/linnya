import { InlineDocumentReferenceAttrsSchema, JsonValueSchema, DocumentReferenceMarkdownBindingSchema, type DocumentReferenceMarkdownBinding, type JsonValue } from '@app/schemas';
import { hydrateDocumentReferenceLinks, referenceObject } from '@linnya/markdown-document-core/references';
import { projectionFromFragments, type MarkdownInlineProjection, type MarkdownInlineFragment, type MarkLike } from '../../../../services/markdownRuntime';

function toJson(value: unknown): JsonValue {
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  return JsonValueSchema.parse(serialized);
}

function readMarks(value: unknown): MarkLike[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Inline marks must be an array.');
  return value.map(mark => {
    const parsed = referenceObject(JsonValueSchema.parse(mark));
    if (!parsed || typeof parsed.type !== 'string') throw new Error('Inline mark has no type.');
    const attrs = parsed.attrs === undefined || parsed.attrs === null ? undefined : referenceObject(parsed.attrs);
    if (attrs === null) throw new Error('Inline mark attrs must be an object.');
    return { type: parsed.type, ...(attrs ? { attrs } : {}) };
  });
}

export function readPendingDocumentReferenceBindings(metadata: Readonly<Record<string, unknown>> | null | undefined): DocumentReferenceMarkdownBinding[] {
  const value = metadata?.document_reference_bindings;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Pending document reference bindings must be an array.');
  return value.map(binding => DocumentReferenceMarkdownBindingSchema.parse(binding));
}
/** 解析器的 link marks 是唯一入口，代码样例和普通文字不会被解释为标签。 */
export function hydrateReferenceProjection(projection: MarkdownInlineProjection, bindings: readonly DocumentReferenceMarkdownBinding[], usedReferenceIds = new Set<string>()): MarkdownInlineProjection {
  if (!bindings.length) return projection;
  const original = new Map(projection.fragments.map(fragment => [JSON.stringify(toJson(fragment)), fragment]));
  const hydrated = referenceObject(hydrateDocumentReferenceLinks({ type: 'paragraph', content: toJson(projection.fragments) }, bindings, usedReferenceIds));
  if (!Array.isArray(hydrated?.content)) throw new Error('Pending reference projection has no inline content.');
  const fragments: MarkdownInlineFragment[] = hydrated.content.map(value => {
    const node = referenceObject(value);
    if (node?.type === 'documentReference') return { type: 'documentReference', attrs: InlineDocumentReferenceAttrsSchema.parse(node.attrs), marks: readMarks(node.marks), textRepresentation: '文档' };
    const fragment = original.get(JSON.stringify(value));
    if (!fragment) throw new Error('Pending reference hydration changed an unrelated inline node.');
    return fragment;
  });
  return projectionFromFragments(fragments, projection.sourceBlockCount, projection.droppedBlockCount);
}
