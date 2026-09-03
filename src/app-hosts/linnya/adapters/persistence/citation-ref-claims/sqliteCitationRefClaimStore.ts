import type Database from 'better-sqlite3';
import type {
  CitationRefClaim,
  CitationRefClaimStorePort,
  CitationRefClaimTransactionPort,
} from '../../../../../domains/citation';

interface CitationRefClaimRow {
  readonly source_identity: string;
  readonly ref: string;
  readonly attempt: number;
}

function projectClaim(row: CitationRefClaimRow | undefined): CitationRefClaim | undefined {
  return row
    ? {
        sourceIdentity: row.source_identity,
        ref: row.ref,
        attempt: row.attempt,
      }
    : undefined;
}

/**
 * SQLite 只负责 Conversation 分区、唯一约束和原子事务；候选生成与碰撞重试留在 Citation domain。
 */
export class SqliteCitationRefClaimStore implements CitationRefClaimStorePort {
  constructor(private readonly db: Database.Database) {}

  runInConversationTransaction<T>(
    conversationId: string,
    operation: (transaction: CitationRefClaimTransactionPort) => T
  ): T {
    const findBySource = this.db.prepare<[string, string], CitationRefClaimRow>(`
      SELECT source_identity, ref, attempt
      FROM conversation_citation_ref_claims
      WHERE conversation_id = ? AND source_identity = ?
    `);
    const findByRef = this.db.prepare<[string, string], CitationRefClaimRow>(`
      SELECT source_identity, ref, attempt
      FROM conversation_citation_ref_claims
      WHERE conversation_id = ? AND ref = ?
    `);
    const insert = this.db.prepare<[string, string, string, number, number]>(`
      INSERT INTO conversation_citation_ref_claims (
        conversation_id, source_identity, ref, attempt, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    // IMMEDIATE 在读取空位前取得写锁，避免两个连接同时为不同来源占用同一短 ref。
    return this.db
      .transaction(() =>
        operation({
          findClaimBySourceIdentity: sourceIdentity =>
            projectClaim(findBySource.get(conversationId, sourceIdentity)),
          findClaimByRef: ref => projectClaim(findByRef.get(conversationId, ref)),
          saveClaim: claim => {
            insert.run(conversationId, claim.sourceIdentity, claim.ref, claim.attempt, Date.now());
          },
        })
      )
      .immediate();
  }
}
