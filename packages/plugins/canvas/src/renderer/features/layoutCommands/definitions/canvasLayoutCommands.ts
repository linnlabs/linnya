import type {
  CanvasArrangeRequest,
  CanvasArrangeResultSchema,
  CanvasEndpoint,
  CanvasPoint,
} from '@plugin/canvas/shared';
import type { z } from 'zod';
export interface CanvasArrangementPort {
  arrange(input: CanvasArrangeRequest): Promise<z.infer<typeof CanvasArrangeResultSchema>>;
  cancel(input: Pick<CanvasArrangeRequest, 'documentId' | 'viewId' | 'requestId'>): Promise<void>;
}
export interface CanvasTreeCreationPlan {
  readonly point: CanvasPoint;
  readonly from: CanvasEndpoint | null;
  readonly options: CanvasArrangeRequest['options'];
}
