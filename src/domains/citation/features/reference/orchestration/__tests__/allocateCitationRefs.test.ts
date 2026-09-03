import { describe, expect, it } from 'vitest';
import type {
  CitationRefClaim,
  CitationRefClaimStorePort,
  CitationRefClaimTransactionPort,
} from '../../definitions/citationRefAllocator';
import { allocateCitationRefs } from '../allocateCitationRefs';

class InMemoryCitationRefClaimStore implements CitationRefClaimStorePort {
  private readonly claimsByConversation = new Map<string, Map<string, CitationRefClaim>>();

  runInConversationTransaction<T>(
    conversationId: string,
    operation: (transaction: CitationRefClaimTransactionPort) => T
  ): T {
    const claims = this.claimsByConversation.get(conversationId) ?? new Map();
    this.claimsByConversation.set(conversationId, claims);
    return operation({
      findClaimBySourceIdentity: sourceIdentity => claims.get(sourceIdentity),
      findClaimByRef: ref => [...claims.values()].find(claim => claim.ref === ref),
      saveClaim: claim => {
        claims.set(claim.sourceIdentity, claim);
      },
    });
  }
}

describe('allocateCitationRefs', () => {
  it('同一 Conversation 复用来源 claim，并按输入顺序对齐重复锚点', () => {
    const claimStore = new InMemoryCitationRefClaimStore();
    const anchor = {
      sourceType: 'knowledge_base' as const,
      docId: 'doc-1',
      blockId: 'block-1',
    };
    const first = allocateCitationRefs({
      conversationId: 'conversation-1',
      anchors: [anchor, anchor],
      claimStore,
    });
    const second = allocateCitationRefs({
      conversationId: 'conversation-1',
      anchors: [anchor],
      claimStore,
    });

    expect(first).toHaveLength(2);
    expect(first[0]).toBe(first[1]);
    expect(second).toEqual([first[0]]);
  });

  it('两个来源首选候选碰撞时只给后接纳来源加 salt', () => {
    const claimStore = new InMemoryCitationRefClaimStore();
    const refs = allocateCitationRefs({
      conversationId: 'conversation-collision',
      anchors: [
        { sourceType: 'web', url: 'https://example.test/article?id=100759' },
        { sourceType: 'web', url: 'https://example.test/article?id=355289' },
      ],
      claimStore,
    });

    expect(refs[0]).toBe('B4Sf9g');
    expect(refs[1]).not.toBe(refs[0]);
    expect(refs[1]).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6}$/);
  });

  it('Conversation 是唯一性边界，不同 Conversation 不共享占位状态', () => {
    const claimStore = new InMemoryCitationRefClaimStore();
    const anchor = { sourceType: 'web' as const, url: 'https://example.test/source' };
    const left = allocateCitationRefs({
      conversationId: 'conversation-left',
      anchors: [anchor],
      claimStore,
    });
    const right = allocateCitationRefs({
      conversationId: 'conversation-right',
      anchors: [anchor],
      claimStore,
    });

    expect(left).toEqual(right);
  });
});
