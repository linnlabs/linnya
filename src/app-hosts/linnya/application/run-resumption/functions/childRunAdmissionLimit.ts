/** 限额拒绝不是运行中断，调用工具可明确选择浅搜索。 */
export class ChildRunLimitExceededError extends Error {
  readonly code = 'CHILD_RUN_LIMIT_EXCEEDED';
  constructor(readonly limit: number) {
    super(`Child run limit reached (${limit} per parent run).`);
  }
}
export function assertChildRunAdmissionLimit(count: number, limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid child run admission limit');
  if (count >= limit) throw new ChildRunLimitExceededError(limit);
}
