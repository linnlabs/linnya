import type { CanvasReviewApprovalInput } from '../definitions/agentReview';

/** 审批与正文同步共享同一确认请求，投递重试不能重新生成请求身份。 */
export async function resolveCanvasReviewApproval(input: CanvasReviewApprovalInput): Promise<void> {
  const { session, port, documentId, pendingId, decision } = input;
  const request = {
    documentId,
    viewId: session.viewId,
    requestId: crypto.randomUUID(),
    pendingId,
    decision,
  };
  await session.confirmMutation({
    send: () => port.approve(request),
    accept: async result => {
      if (result.kind === 'committed') await session.synchronize(result.commit.sequence);
    },
  });
}
