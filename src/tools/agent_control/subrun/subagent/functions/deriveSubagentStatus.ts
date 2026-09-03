import type { SubagentStatus } from '@app/schemas';

/** 保持既有终态分类：最终答案优先表示完成，留下正式产物则至少是部分完成。 */
export function deriveSubagentStatus(input: {
  readonly cancelled: boolean;
  readonly error: string | undefined;
  readonly finalAnswer: string;
  readonly artifactCount: number;
}): SubagentStatus {
  if (input.cancelled) return 'cancelled';
  if (!input.error && input.finalAnswer.trim().length > 0) return 'completed';
  if (input.finalAnswer.trim().length > 0 || input.artifactCount > 0) return 'partial';
  return 'failed';
}
