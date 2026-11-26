import { InlineDocumentReferenceAttrsSchema, type DocumentReferenceInput, type DocumentReferenceMarkdownBinding, type DocumentReferencePresentation, type JsonValue } from '@app/schemas';

export type ReferenceJsonObject = { [key: string]: JsonValue };

/**
 * 文档引用标签上的文字，编辑器标签与只读预览（含画布卡片）共用这一份，不能各写一套：
 * 目标已删除、在其他项目时说明状态，否则显示标题，没有标题时用通用的“文档”。
 * 只区分中文与其他语言（其他语言用英文），与预览的 locale 约定一致。
 */
export function documentReferenceLabel(presentation: Pick<DocumentReferencePresentation, 'status' | 'title'>, locale: string): string {
  const chinese = locale.startsWith('zh');
  if (presentation.status === 'deleted') return chinese ? '文档已删除' : 'Deleted document';
  if (presentation.status === 'outside_project') return chinese ? '其他项目的文档' : 'Document in another project';
  return presentation.title ?? documentReferenceGenericLabel(locale);
}

/** 还不知道目标状态（编辑器正在查询）或目标没有标题时的通用文字。 */
export function documentReferenceGenericLabel(locale: string): string {
  return locale.startsWith('zh') ? '文档' : 'Document';
}
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
export function encodedReferencePath(path: string): string { return 'workspace:' + path.slice('workspace:'.length).split('/').map(segment => encodeURIComponent(segment).replace(/[()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())).join('/'); }
export function commonReferenceMarks(nodes: readonly ReferenceJsonObject[]): JsonValue[] {
  const first = nodes[0]; const marks = Array.isArray(first?.marks) ? first.marks : [];
  return marks.filter(mark => referenceObject(mark)?.type !== 'link' && nodes.every(node => Array.isArray(node.marks) && node.marks.some(other => JSON.stringify(other) === JSON.stringify(mark))));
}

/** 只处理解析器确认的 link marks；代码与裸字符串不会被重新解释。 */
export function transformWorkspaceReferenceLinks(content: JsonValue, resolve: (nodes: readonly ReferenceJsonObject[], href: string) => JsonValue): JsonValue {
  function transform(value: JsonValue): JsonValue {
    const node = referenceObject(value); if (!node || node.type === 'codeBlock') return value;
    const children = referenceChildren(node); if (!children) return node;
    const next: JsonValue[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const child = referenceObject(children[index]); const href = child ? workspaceReferenceHref(child) : null;
      if (!child || !href) { next.push(transform(children[index])); continue; }
      if (child.type !== 'text') throw new Error('A workspace reference link must contain text.');
      const group = [child];
      while (index + 1 < children.length) { const following = referenceObject(children[index + 1]); if (!following || following.type !== 'text' || workspaceReferenceHref(following) !== href) break; group.push(following); index += 1; }
      next.push(resolve(group, href));
    }
    return { ...node, content: next };
  }
  return transform(content);
}

/** 已接纳修订按持久绑定恢复；不访问当前路径，防止同路径替换改变提案身份。 */
export function hydrateDocumentReferenceLinks(content: JsonValue, bindings: readonly DocumentReferenceMarkdownBinding[], used = new Set<string>()): JsonValue {
  return transformWorkspaceReferenceLinks(content, (nodes, href) => {
    const path = normalizedReferencePath(href); const label = nodes.map(node => typeof node.text === 'string' ? node.text : '').join('');
    const binding = bindings.find(candidate => candidate.path === path && candidate.label === label && !used.has(candidate.referenceId));
    if (!binding) throw new Error('Pending document reference has no admitted identity binding.');
    used.add(binding.referenceId); const marks = commonReferenceMarks(nodes);
    return { type: 'documentReference', attrs: { documentId: binding.targetDocumentId, referenceId: binding.referenceId }, ...(marks.length ? { marks } : {}) };
  });
}
