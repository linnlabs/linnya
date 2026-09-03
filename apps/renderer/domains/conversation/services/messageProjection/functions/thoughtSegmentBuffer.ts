import type { ExecutionProjectionState } from '../state';

/** run / execution 已由外层状态隔离；这里继续按 turn 与 thought segment 双重身份分桶。 */
export function readThoughtSegmentBuffer(
  executionState: ExecutionProjectionState,
  turnId: string,
  thoughtMessageId: string,
): string {
  return executionState.thoughtBuffers.get(turnId)?.get(thoughtMessageId) ?? '';
}

export function writeThoughtSegmentBuffer(
  executionState: ExecutionProjectionState,
  turnId: string,
  thoughtMessageId: string,
  content: string,
): void {
  const turnBuffers = executionState.thoughtBuffers.get(turnId) ?? new Map<string, string>();
  turnBuffers.set(thoughtMessageId, content);
  executionState.thoughtBuffers.set(turnId, turnBuffers);
}

export function deleteThoughtSegmentBuffer(
  executionState: ExecutionProjectionState,
  turnId: string,
  thoughtMessageId: string,
): void {
  const turnBuffers = executionState.thoughtBuffers.get(turnId);
  if (!turnBuffers) return;
  turnBuffers.delete(thoughtMessageId);
  if (turnBuffers.size === 0) executionState.thoughtBuffers.delete(turnId);
}
