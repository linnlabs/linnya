import type { ActionLedgerDocumentChange } from 'src/domains/action-ledger';

export interface MergedRunDocumentChange {
  readonly documentId: string;
  /** 这些运行里新建了它。 */
  readonly created: boolean;
  readonly actor: 'run' | 'subrun' | 'mixed';
  readonly lastRecordedAt: number;
}

/**
 * 账本按“执行者 × 文档”合项；对话里按文档列一行。只看运行身份，用户与插件的改动不属于这一轮回复。
 * 结果按最近改动倒序。
 */
export function mergeRunDocumentChanges(
  changes: readonly ActionLedgerDocumentChange[],
): MergedRunDocumentChange[] {
  const byDocument = new Map<string, { created: boolean; run: boolean; subrun: boolean; last: number }>();
  for (const change of changes) {
    if (change.actorKind !== 'run' && change.actorKind !== 'subrun') continue;
    const entry = byDocument.get(change.documentId) ?? { created: false, run: false, subrun: false, last: 0 };
    entry.created ||= change.actions.includes('create');
    entry[change.actorKind] = true;
    entry.last = Math.max(entry.last, change.lastRecordedAt);
    byDocument.set(change.documentId, entry);
  }
  return [...byDocument].map(([documentId, entry]) => ({
    documentId,
    created: entry.created,
    actor: entry.run && entry.subrun ? 'mixed' as const : entry.subrun ? 'subrun' as const : 'run' as const,
    lastRecordedAt: entry.last,
  })).sort((a, b) => b.lastRecordedAt - a.lastRecordedAt);
}
