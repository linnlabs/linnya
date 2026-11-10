import type { RunDocumentChangeItem } from '../definitions/runDocumentChanges';

/** 展开后先列这么多份，其余按需再显示。 */
export const RUN_DOCUMENT_CHANGES_VISIBLE_LIMIT = 7;

export interface RunDocumentChangesNote {
  /** 待审阅的排最前，其余保持最近改动在前。 */
  readonly items: readonly RunDocumentChangeItem[];
  readonly pendingDocumentCount: number;
  /** 只改了一份时不折叠，一行写全。 */
  readonly single: RunDocumentChangeItem | null;
}

export function projectRunDocumentChangesNote(
  items: readonly RunDocumentChangeItem[],
): RunDocumentChangesNote | null {
  if (items.length === 0) return null;
  const pending = items.filter(item => item.status.kind === 'pending');
  const rest = items.filter(item => item.status.kind !== 'pending');
  return {
    items: [...pending, ...rest],
    pendingDocumentCount: pending.length,
    single: items.length === 1 ? items[0] ?? null : null,
  };
}

/** 整行点击的打开意图：有待审阅就进审阅，其余直接打开。 */
export function resolveRunDocumentChangePrimaryIntent(item: RunDocumentChangeItem): 'open' | 'review' {
  return item.status.kind === 'pending' ? 'review' : 'open';
}

export function canOpenRunDocumentChange(item: RunDocumentChangeItem): boolean {
  return !item.deleted && item.activeDocumentType !== null;
}
