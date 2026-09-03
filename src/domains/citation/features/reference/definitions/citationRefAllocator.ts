import type { CitationSourceAnchor } from '../../../shared/definitions/citationSourceAnchor';

export interface CitationRefClaim {
  readonly sourceIdentity: string;
  readonly ref: string;
  readonly attempt: number;
}

/** 单个 Conversation 的原子 claim 事务；具体存储不拥有 ref 生成规则。 */
export interface CitationRefClaimTransactionPort {
  findClaimBySourceIdentity(sourceIdentity: string): CitationRefClaim | undefined;
  findClaimByRef(ref: string): CitationRefClaim | undefined;
  saveClaim(claim: CitationRefClaim): void;
}

/** Host 提供的持久化边界。事务必须串行化同一 Conversation 的读后写。 */
export interface CitationRefClaimStorePort {
  runInConversationTransaction<T>(
    conversationId: string,
    operation: (transaction: CitationRefClaimTransactionPort) => T
  ): T;
}

/** producer 只依赖这个窄端口，不感知 SQLite、salt 或碰撞重试。 */
export interface CitationRefAllocatorPort {
  allocate(anchors: readonly CitationSourceAnchor[]): Promise<readonly string[]>;
}
