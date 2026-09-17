import type { MarkdownRevisionCommit } from '@app/schemas';
import type { PendingRevision } from '../definitions/pendingRevision';

/** CAS 校验同时覆盖正文与提议。相同 ID 的提议更新也必须拒绝旧决策。 */
export function assertMarkdownRevisionExpectation(
  request: Pick<MarkdownRevisionCommit, 'expectedVersionNumber' | 'expectedPending'>,
  versionNumber: number,
  pendings: readonly PendingRevision[],
): void {
  const expected = new Map(request.expectedPending.map(item => [item.id, item.revision]));
  if (versionNumber !== request.expectedVersionNumber || expected.size !== request.expectedPending.length ||
      expected.size !== pendings.length || pendings.some(item => expected.get(item.id) !== item.revision)) {
    throw new Error('文档或待处理修订已更新，请刷新后重试；本地编辑尚未提交。');
  }
}
