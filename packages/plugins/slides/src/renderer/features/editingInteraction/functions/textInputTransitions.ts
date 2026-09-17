import type { ManualEditSettlement } from '../../manualEditing';
import type { TextEditingTarget } from '../../textEditing';
import type { TextDraftPresentation, TextInputSession } from '../definitions/editingInteractionTypes';

export function openTextInputSession(
  target: TextEditingTarget,
  draft: TextDraftPresentation | undefined,
  sessionId: string,
): TextInputSession {
  return {
    phase: 'editing', sessionId, target,
    draft: draft?.content ?? target.content,
    // 待保存内容已经进入队列；失败内容仍要允许原样重试。
    baseline: draft?.status === 'pending' ? draft.content : target.content,
    composing: false, finishRequested: false,
  };
}

export function settleTextDraft(
  drafts: readonly TextDraftPresentation[],
  clientOperationId: string,
  result: ManualEditSettlement,
): readonly TextDraftPresentation[] {
  return drafts.flatMap(draft => {
    if (draft.clientOperationId !== clientOperationId) return [draft];
    if (result.status === 'presented' || result.status === 'cancelled') return [];
    return [{ ...draft, status: 'failed' as const, message: result.message }];
  });
}
