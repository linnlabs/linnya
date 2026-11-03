import type { CanvasCommitResult } from '@plugin/canvas/shared';
export class CanvasCommitOutcomeError extends Error {
  constructor(message: string, readonly result: CanvasCommitResult) { super(message); }
}
/** 用户相对操作和显式排布共用准确结果说明；已成功内容须先由调用方同步。 */
export function requireCanvasUserCommitApplied(result: CanvasCommitResult): void {
  const skipped = result.results.filter(outcome => outcome.status === 'skipped');
  if (!skipped.length) return;
  const applied = result.results.length - skipped.length;
  throw new CanvasCommitOutcomeError(`${applied ? `已提交 ${applied} 项，另有 ${skipped.length} 项跳过` : '本次修改未提交'}：${[...new Set(skipped.map(outcome => outcome.reason ?? '内容已变化，请重试'))].join('；')}`, result);
}
