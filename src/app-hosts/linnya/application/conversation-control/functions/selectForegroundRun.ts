import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlRunRecord } from '../definitions/conversationControlUseCase';

const ACTIVE_STATUSES = new Set<ConversationControlRunRecord['status']>([
  'pending',
  'running',
  'awaiting_user',
  'paused',
]);

export function isForegroundRootRun(run: ConversationControlRunRecord): boolean {
  return run.parentRunId === undefined && run.metadata?.lane === 'foreground';
}

export function isActiveRun(run: ConversationControlRunRecord): boolean {
  return ACTIVE_STATUSES.has(run.status);
}

/** 已收口暂停可被正式新消息原子替代；仍在停止的 execution 不允许抢占。 */
export function blocksForegroundAdmission(run: ConversationControlRunRecord): boolean {
  return (
    isForegroundRootRun(run) &&
    isActiveRun(run) &&
    !(run.status === 'paused' && run.pausedAt !== undefined)
  );
}

export type ConversationControlTerminalRunRecord = ConversationControlRunRecord & {
  readonly status: 'completed' | 'failed' | 'cancelled';
};

export function isTerminalRun(
  run: ConversationControlRunRecord
): run is ConversationControlTerminalRunRecord {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
}

export function selectStatusRun(
  conversationId: string,
  runs: readonly ConversationControlRunRecord[],
  expectedRunId?: string
): ConversationControlRunRecord | null {
  const foreground = runs.filter(isForegroundRootRun);
  if (expectedRunId) {
    const expected = foreground.find(run => run.runId === expectedRunId);
    if (!expected) {
      throw new ConversationControlError(
        'run_not_found',
        `Run ${expectedRunId} does not belong to conversation ${conversationId}`
      );
    }
    return expected;
  }

  const active = foreground.filter(isActiveRun);
  if (active.length > 1) {
    throw new ConversationControlError(
      'internal_error',
      `Conversation ${conversationId} has multiple active foreground runs`
    );
  }
  if (active[0]) return active[0];

  return (
    [...foreground]
      .filter(isTerminalRun)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  );
}

/** exact run 是 stop 的幂等身份；重试旧终态不能误停同一会话的新 run。 */
export function selectStopRun(
  conversationId: string,
  runs: readonly ConversationControlRunRecord[],
  expectedRunId?: string,
): ConversationControlRunRecord {
  if (expectedRunId) {
    const target = selectStatusRun(conversationId, runs, expectedRunId);
    if (target) return target;
  }
  const active = runs.filter(run => isForegroundRootRun(run) && isActiveRun(run));
  if (active.length !== 1 || !active[0]) {
    throw new ConversationControlError('no_active_run',
      `Conversation ${conversationId} has no single active foreground run; use --run to confirm a specific run's settlement`);
  }
  return active[0];
}

export function selectLatestTerminalRun(
  conversationId: string,
  runs: readonly ConversationControlRunRecord[],
  expectedRunId?: string
): ConversationControlTerminalRunRecord {
  const selected = selectStatusRun(conversationId, runs, expectedRunId);
  if (!selected) {
    throw new ConversationControlError(
      'run_not_found',
      `Conversation ${conversationId} has no run`
    );
  }
  if (!isTerminalRun(selected)) {
    throw new ConversationControlError(
      'result_unavailable',
      `Run ${selected.runId} has not reached a terminal state`,
      true
    );
  }
  return selected;
}
