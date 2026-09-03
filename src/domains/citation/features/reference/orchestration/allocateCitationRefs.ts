import { isCanonicalCitationRef } from '../functions/citationRef';
import {
  createCitationRefCandidate,
  MAX_CITATION_REF_COLLISION_ATTEMPTS,
} from '../functions/createCitationRefCandidate';
import type {
  CitationRefAllocatorPort,
  CitationRefClaimStorePort,
  CitationRefClaimTransactionPort,
} from '../definitions/citationRefAllocator';
import type { CitationSourceAnchor } from '../../../shared/definitions/citationSourceAnchor';
import { createCitationSourceIdentity } from '../../../shared/functions/citationSourceAnchor';

function assertStoredClaim(params: {
  readonly sourceIdentity: string;
  readonly ref: string;
  readonly attempt: number;
}): void {
  if (!isCanonicalCitationRef(params.ref)) {
    throw new Error(`Citation ref claim ${JSON.stringify(params.ref)} 不符合 canonical 合同。`);
  }
  if (!Number.isInteger(params.attempt) || params.attempt < 0) {
    throw new Error(`Citation ref claim ${params.ref} 的 attempt 不合法。`);
  }
  const expected = createCitationRefCandidate(params.sourceIdentity, params.attempt);
  if (expected !== params.ref) {
    throw new Error(`Citation ref claim ${params.ref} 与确定性分配规则不一致。`);
  }
}

function claimRef(transaction: CitationRefClaimTransactionPort, sourceIdentity: string): string {
  const existing = transaction.findClaimBySourceIdentity(sourceIdentity);
  if (existing) {
    assertStoredClaim(existing);
    return existing.ref;
  }

  for (let attempt = 0; attempt < MAX_CITATION_REF_COLLISION_ATTEMPTS; attempt += 1) {
    const ref = createCitationRefCandidate(sourceIdentity, attempt);
    const owner = transaction.findClaimByRef(ref);
    if (owner) {
      assertStoredClaim(owner);
      if (owner.sourceIdentity === sourceIdentity) return owner.ref;
      continue;
    }
    transaction.saveClaim({ sourceIdentity, ref, attempt });
    return ref;
  }
  throw new Error('无法为 Conversation 分配唯一的 6 位 Citation ref（发生异常碰撞）。');
}

/**
 * 一批锚点在同一事务中完成复用或占位；重复锚点返回同一个 ref，输出严格对齐输入顺序。
 */
export function allocateCitationRefs(params: {
  readonly conversationId: string;
  readonly anchors: readonly CitationSourceAnchor[];
  readonly claimStore: CitationRefClaimStorePort;
}): readonly string[] {
  const conversationId = params.conversationId.trim();
  if (!conversationId) throw new Error('Citation ref allocator 缺少 conversationId。');
  if (params.anchors.length === 0) return [];

  const identities = params.anchors.map(createCitationSourceIdentity);
  return params.claimStore.runInConversationTransaction(conversationId, transaction => {
    const refByIdentity = new Map<string, string>();
    for (const identity of identities) {
      if (!refByIdentity.has(identity)) {
        refByIdentity.set(identity, claimRef(transaction, identity));
      }
    }
    return identities.map(identity => {
      const ref = refByIdentity.get(identity);
      if (!ref) throw new Error('Citation ref allocator 丢失已分配的来源身份。');
      return ref;
    });
  });
}

export function createCitationRefAllocator(params: {
  readonly conversationId: string;
  readonly claimStore: CitationRefClaimStorePort;
}): CitationRefAllocatorPort {
  return {
    async allocate(anchors) {
      return allocateCitationRefs({ ...params, anchors });
    },
  };
}
