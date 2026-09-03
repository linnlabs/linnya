import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { projectEventToUiRowOps } from './projectEvent';
import type {
  NewUiMessageRow,
  UiMessageRow,
  UiProjectionReadAccess,
  UiRowOp,
} from './types';

export interface AppliedUiProjection {
  readonly rows: readonly UiMessageRow[];
  readonly skipped: readonly Extract<UiRowOp, { op: 'skip' }>[];
}

export class InMemoryUiProjectionAccess implements UiProjectionReadAccess {
  private readonly rowsByMessageId = new Map<string, UiMessageRow>();
  private readonly rowsByMergeKey = new Map<string, UiMessageRow>();
  private readonly skippedOps: Array<Extract<UiRowOp, { op: 'skip' }>> = [];
  private nextSortSeq = 1;

  getRowByMergeKey(conversationId: string, mergeKey: string): UiMessageRow | null {
    const row = this.rowsByMergeKey.get(buildScopedKey(conversationId, mergeKey));
    return row ?? null;
  }

  getRowByMessageId(conversationId: string, messageId: string): UiMessageRow | null {
    const row = this.rowsByMessageId.get(buildScopedKey(conversationId, messageId));
    return row ?? null;
  }

  applyOps(ops: readonly UiRowOp[]): void {
    for (const op of ops) {
      this.applyOp(op);
    }
  }

  snapshot(): AppliedUiProjection {
    return {
      rows: Array.from(this.rowsByMessageId.values()).sort((a, b) => a.sortSeq - b.sortSeq),
      skipped: [...this.skippedOps],
    };
  }

  private applyOp(op: UiRowOp): void {
    switch (op.op) {
      case 'insert':
        this.insert(op.row);
        break;
      case 'replace':
        this.replace(op.row);
        break;
      case 'hide':
        this.hide(op.messageIds);
        break;
      case 'skip':
        this.skippedOps.push(op);
        break;
    }
  }

  private insert(row: NewUiMessageRow): void {
    const existing = this.getRowByMessageId(row.conversationId, row.messageId);
    if (existing) {
      this.replace({ ...row, sortSeq: existing.sortSeq });
      return;
    }
    this.replace({ ...row, sortSeq: this.nextSortSeq });
    this.nextSortSeq += 1;
  }

  private replace(row: UiMessageRow): void {
    this.rowsByMessageId.set(buildScopedKey(row.conversationId, row.messageId), row);
    if (row.mergeKey) {
      this.rowsByMergeKey.set(buildScopedKey(row.conversationId, row.mergeKey), row);
    }
  }

  private hide(messageIds: readonly string[]): void {
    for (const row of this.rowsByMessageId.values()) {
      if (!messageIds.includes(row.messageId)) {
        continue;
      }
      this.replace({
        ...row,
        presentation: 'hidden',
      });
    }
  }
}

export function projectEventsWithMemoryApplier(
  events: readonly RuntimeEvent[],
): AppliedUiProjection {
  const access = new InMemoryUiProjectionAccess();
  for (const event of events) {
    access.applyOps(projectEventToUiRowOps(event, access));
  }
  return access.snapshot();
}

function buildScopedKey(conversationId: string, key: string): string {
  return `${conversationId}\u0000${key}`;
}
