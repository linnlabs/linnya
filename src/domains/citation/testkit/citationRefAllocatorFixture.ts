import type {
  CitationRefAllocatorPort,
  CitationRefClaim,
  CitationRefClaimStorePort,
  CitationRefClaimTransactionPort,
} from '../features/reference/definitions/citationRefAllocator';
import {
  allocateCitationRefs,
  createCitationRefAllocator,
} from '../features/reference/orchestration/allocateCitationRefs';
import type { CitationSourceAnchor } from '../shared/definitions/citationSourceAnchor';

class InMemoryCitationRefClaimStore implements CitationRefClaimStorePort {
  private readonly claims = new Map<string, CitationRefClaim>();

  runInConversationTransaction<T>(
    _conversationId: string,
    operation: (transaction: CitationRefClaimTransactionPort) => T
  ): T {
    return operation({
      findClaimBySourceIdentity: sourceIdentity => this.claims.get(sourceIdentity),
      findClaimByRef: ref => [...this.claims.values()].find(claim => claim.ref === ref),
      saveClaim: claim => {
        this.claims.set(claim.sourceIdentity, claim);
      },
    });
  }
}

/** 非持久化测试夹具；规则复用正式编排，只有 claim store 被替换为单进程 Map。 */
export function createCitationRefAllocatorFixture(): CitationRefAllocatorPort {
  return createCitationRefAllocator({
    conversationId: 'citation-test-fixture',
    claimStore: new InMemoryCitationRefClaimStore(),
  });
}

/** 让跨 domain 测试通过正式分配编排构造单个预期 ref，避免依赖内部候选算法。 */
export function allocateCitationRefFixture(anchor: CitationSourceAnchor): string {
  const refs = allocateCitationRefs({
    conversationId: 'citation-single-ref-fixture',
    anchors: [anchor],
    claimStore: new InMemoryCitationRefClaimStore(),
  });
  const ref = refs[0];
  if (!ref) throw new Error('Citation ref fixture 未生成预期 ref。');
  return ref;
}
