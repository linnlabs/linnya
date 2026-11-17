import type { KnowledgeSourceTarget } from '../definitions/knowledgeApplicationSurface';

export interface KnowledgeSourceLookup {
  listProjectKnowledgeBaseIds(projectId: string): Promise<readonly string[]>;
  listDocumentIds(kbId: string): Promise<readonly string[]>;
}

/** 引用是证据身份，不是绕过当前项目范围的授权；失败绝不能当作“没有绑定”。 */
export async function resolveKnowledgeSource(
  target: KnowledgeSourceTarget,
  signal: AbortSignal,
  lookup: KnowledgeSourceLookup,
): Promise<string> {
  signal.throwIfAborted();
  const linked = target.projectId === null ? [] : await lookup.listProjectKnowledgeBaseIds(target.projectId);
  signal.throwIfAborted();
  const candidates = linked.length > 0 ? linked : ['default'];
  if (target.containerId && !candidates.includes(target.containerId)) {
    throw new Error('该来源不在当前项目关联的知识库范围内');
  }
  for (const kbId of target.containerId ? [target.containerId] : candidates) {
    const documents = await lookup.listDocumentIds(kbId);
    signal.throwIfAborted();
    if (documents.includes(target.sourceId)) return kbId;
  }
  throw new Error('当前项目关联的知识库中没有此来源，历史引用仍可查看');
}
