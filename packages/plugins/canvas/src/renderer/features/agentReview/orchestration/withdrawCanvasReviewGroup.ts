import type { CanvasReviewWithdrawalInput } from '../definitions/agentReview';
import { projectCanvasWithdrawalSummary } from '../functions/projectCanvasReviewOutcome';

/** 先确认撤回实际提交并追平正文，再投影此次撤回结果；重试沿用同一请求身份。 */
export async function withdrawCanvasReviewGroup(input: CanvasReviewWithdrawalInput): Promise<void> {
  const { session, port, state, documentId, groupId, elementIds } = input;
  const request = {
    documentId,
    viewId: session.viewId,
    requestId: crypto.randomUUID(),
    groupId,
    ...(elementIds !== undefined ? { elementIds: [...elementIds] } : {}),
  };
  const elements = session.state.snapshot.value?.elements ?? [];
  const group = state.groups.value.find(value => value.id === groupId);
  const result = await session.confirmMutation({
    send: () => port.withdraw(request),
    accept: result => session.synchronize(result.commit.sequence),
  });
  state.withdrawn(projectCanvasWithdrawalSummary(result.commit, elements, group));
}
