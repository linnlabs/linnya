import type { SlidesDraftStatus } from '@plugin/slides/shared';
import type { PresentationDraftRecord } from '../definitions/presentationRepository';

/** 把存储记录投影为 codegen、IPC 与 renderer 共享的稳定 draft 状态。 */
export function toSlidesDraftStatus(draft: PresentationDraftRecord): SlidesDraftStatus {
  return {
    baseVersionId: draft.baseRevisionId,
    baseVersionNumber: draft.baseRevision,
    ...(draft.lastErrorKind ? { errorKind: draft.lastErrorKind } : {}),
    ...(draft.lastErrorSummary ? { errorSummary: draft.lastErrorSummary } : {}),
    updatedAt: draft.updatedAt,
  };
}
