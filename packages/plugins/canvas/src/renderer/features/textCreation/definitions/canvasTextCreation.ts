import type { CanvasArrangeRequest, CanvasCommand, CanvasCommitResult, CanvasEndpoint, CanvasPoint, CanvasRectangle, CanvasTextDocument } from '@plugin/canvas/shared';
export type CanvasTextCreationCommit = (operations: readonly CanvasCommand[], historyGroupId: string, arrangement: CanvasArrangeRequest['options'] | null) => Promise<CanvasCommitResult>;
export interface CanvasTextCreationDraft extends CanvasRectangle {
  readonly identity: string; readonly content: CanvasTextDocument; readonly from: CanvasEndpoint | null;
  readonly anchor: CanvasPoint;
  readonly arrangement: CanvasArrangeRequest['options'] | null;
  readonly editSequence: number;
}
