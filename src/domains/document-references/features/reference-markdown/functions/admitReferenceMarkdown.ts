import type { DocumentReferenceMarkdownBinding, JsonValue } from '@app/schemas';
import type { ReferenceMarkdownBaseline, ReferenceMarkdownPort, ReferenceMarkdownPrepared } from '../definitions/referenceMarkdown';
import { ReferenceMarkdownError } from '../definitions/referenceMarkdown';
import { assertReferenceMarkdownBindings, projectReferenceMarkdown } from './projectReferenceMarkdown';
import { collectDocumentReferenceInputs, commonReferenceMarks, normalizedReferencePath, referenceChildren, referenceObject, workspaceReferenceHref, type ReferenceJsonObject } from './referenceContent';

export function admitReferenceMarkdown(input: { readonly sourceDocumentId: string; readonly existingContent?: JsonValue; readonly content: JsonValue; readonly baseline?: ReferenceMarkdownBaseline }, port: ReferenceMarkdownPort, allocateReferenceId: () => string): ReferenceMarkdownPrepared {
  const source = port.read(input.sourceDocumentId);
  if (!source || source.deletedAt !== null || !source.projectId) throw new ReferenceMarkdownError('reference_source_unavailable');
  const projectId = source.projectId;
  const existing = input.existingContent ? collectDocumentReferenceInputs(input.existingContent) : [];
  if (existing.length && (!input.baseline || existing.some(reference => !input.baseline?.bindings.some(binding => binding.referenceId === reference.referenceId) && !input.baseline?.unprojectableReferenceIds.includes(reference.referenceId)))) throw new ReferenceMarkdownError('reference_read_required');
  const currentProjection = input.existingContent ? projectReferenceMarkdown({ sourceDocumentId: input.sourceDocumentId, content: input.existingContent }, port) : null;
  if (currentProjection?.baseline.unprojectableReferenceIds.length || input.baseline?.unprojectableReferenceIds.length) throw new ReferenceMarkdownError('reference_projection_lossy');
  const knownBindings = [...(input.baseline?.bindings ?? []), ...(input.baseline ? currentProjection?.baseline.bindings ?? [] : [])];
  const used = new Set<string>(); const bindings: DocumentReferenceMarkdownBinding[] = [];
  function resolve(nodes: readonly ReferenceJsonObject[], href: string): JsonValue {
    const path = normalizedReferencePath(href); const label = nodes.map(node => typeof node.text === 'string' ? node.text : '').join('');
    const pathBindings = knownBindings.filter(binding => binding.path === path);
    const seen = pathBindings.filter(binding => binding.label === label);
    // 即使同一引用已在本次出现过，旧地址也先校验；复制不能绕过已读路径的身份变化。
    assertReferenceMarkdownBindings(input.sourceDocumentId, pathBindings, port);
    const previous = seen.find(binding => !used.has(binding.referenceId));
    const target = previous ? port.read(previous.targetDocumentId) : port.resolvePath(projectId, path);
    if (!target || target.deletedAt !== null || target.projectId !== projectId || target.nodeType === 'folder') throw new ReferenceMarkdownError('reference_path_not_found');
    const binding = { referenceId: previous?.referenceId ?? allocateReferenceId(), targetDocumentId: target.id, path, label };
    used.add(binding.referenceId); bindings.push(binding);
    const marks = commonReferenceMarks(nodes);
    return { type: 'documentReference', attrs: { documentId: target.id, referenceId: binding.referenceId }, ...(marks.length ? { marks } : {}) };
  }
  function transform(value: JsonValue): JsonValue {
    const node = referenceObject(value); if (!node || node.type === 'codeBlock') return value;
    const children = referenceChildren(node); if (!children) return node;
    const next: JsonValue[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const child = referenceObject(children[index]); const href = child ? workspaceReferenceHref(child) : null;
      if (!child || !href) { next.push(transform(children[index])); continue; }
      if (child.type !== 'text') throw new ReferenceMarkdownError('reference_path_not_found');
      const group = [child];
      while (index + 1 < children.length) { const following = referenceObject(children[index + 1]); if (!following || following.type !== 'text' || workspaceReferenceHref(following) !== href) break; group.push(following); index += 1; }
      next.push(resolve(group, href));
    }
    return { ...node, content: next };
  }
  const content = transform(input.content);
  assertReferenceMarkdownBindings(input.sourceDocumentId, bindings, port);
  return { content, references: collectDocumentReferenceInputs(content), bindings };
}
