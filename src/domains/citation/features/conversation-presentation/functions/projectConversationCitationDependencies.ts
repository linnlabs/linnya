import {
  ConversationCitationDependencySnapshotSchema,
  type ConversationCitationDependencySnapshot,
  type SearchResultCitation,
} from '@app/schemas';

import type { ConversationCitationWorkspace } from '../definitions/conversationCitationWorkspace';
import { createCitationSourceIdentity } from '../../../shared/functions/citationSourceAnchor';

export function createConversationCitationWorkspace(): ConversationCitationWorkspace {
  return new Map();
}

/** 同 scope/ref 只能绑定一个稳定来源锚点；更新在 detached Map 上原子投影。 */
export function projectConversationCitationRegistration(
  workspace: ConversationCitationWorkspace,
  scopeId: string,
  citations: readonly SearchResultCitation[]
): ConversationCitationWorkspace {
  if (citations.length === 0) return workspace;
  const nextScope = new Map(workspace.get(scopeId) ?? []);
  for (const citation of citations) {
    const existing = nextScope.get(citation.ref);
    if (
      existing &&
      createCitationSourceIdentity(existing) !== createCitationSourceIdentity(citation)
    ) {
      throw new Error(
        `[ConversationCitationWorkspace] scope=${scopeId} ref=${citation.ref} 指向了两个不同来源`
      );
    }
    // 同一来源再次出现时保留首次接纳快照，避免标题/snippet 随后续工具结果漂移。
    if (!existing) nextScope.set(citation.ref, citation);
  }
  const next = new Map(workspace);
  next.set(scopeId, nextScope);
  return next;
}

function resolveCitation(
  workspace: ConversationCitationWorkspace,
  scopeId: string,
  ref: string
): SearchResultCitation | null {
  const exact = workspace.get(scopeId)?.get(ref);
  if (exact) return exact;

  let resolved: SearchResultCitation | null = null;
  let resolvedIdentity: string | null = null;
  for (const citations of workspace.values()) {
    const candidate = citations.get(ref);
    if (!candidate) continue;
    const identity = createCitationSourceIdentity(candidate);
    if (resolvedIdentity !== null && resolvedIdentity !== identity) return null;
    if (resolvedIdentity === null) {
      resolved = candidate;
      resolvedIdentity = identity;
    }
  }
  return resolved;
}

/**
 * 当前 scope 优先；跨 scope 只在 ref 唯一指向同一来源时解析。
 * 冲突或缺失一律进入 unresolved_refs，禁止调用方再做全局 fallback。
 */
export function projectConversationCitationDependencies(
  workspace: ConversationCitationWorkspace,
  scopeId: string,
  refs: readonly string[]
): ConversationCitationDependencySnapshot {
  const citations: SearchResultCitation[] = [];
  const unresolvedRefs: string[] = [];
  for (const ref of refs) {
    const citation = resolveCitation(workspace, scopeId, ref);
    if (citation) citations.push(citation);
    else unresolvedRefs.push(ref);
  }
  return ConversationCitationDependencySnapshotSchema.parse({
    citations,
    unresolved_refs: unresolvedRefs,
  });
}

/**
 * 校验 snapshot 是否精确覆盖正文中的 canonical ref。
 *
 * 这里比较依赖集合而非数组拼接顺序，因为 resolved 与 unresolved 在合同中分栏存放；
 * 各栏内部仍由投影函数保持正文首次出现顺序。
 */
export function isConversationCitationDependencyClosure(
  refs: readonly string[],
  snapshot: ConversationCitationDependencySnapshot
): boolean {
  const resolvedRefs = snapshot.citations.map(citation => citation.ref);
  const unresolvedRefs = snapshot.unresolved_refs;
  const expectedResolvedRefs = refs.filter(ref => resolvedRefs.includes(ref));
  const expectedUnresolvedRefs = refs.filter(ref => unresolvedRefs.includes(ref));
  return (
    expectedResolvedRefs.length === resolvedRefs.length &&
    expectedUnresolvedRefs.length === unresolvedRefs.length &&
    resolvedRefs.length + unresolvedRefs.length === refs.length &&
    expectedResolvedRefs.every((ref, index) => resolvedRefs[index] === ref) &&
    expectedUnresolvedRefs.every((ref, index) => unresolvedRefs[index] === ref)
  );
}
