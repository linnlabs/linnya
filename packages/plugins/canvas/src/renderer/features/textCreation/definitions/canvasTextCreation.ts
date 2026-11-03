import type { CanvasEndpoint, CanvasPoint, CanvasRectangle, CanvasTextDocument } from '@plugin/canvas/shared';
export interface CanvasTextCreationDraft extends CanvasRectangle {
  readonly identity: string; readonly content: CanvasTextDocument; readonly from: CanvasEndpoint | null;
  readonly anchor: CanvasPoint;
  readonly editSequence: number;
}
