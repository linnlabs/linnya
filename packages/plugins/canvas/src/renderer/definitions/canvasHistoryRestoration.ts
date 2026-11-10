import type { CanvasRestoredMessageSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
export type CanvasRestoredMessage = z.infer<typeof CanvasRestoredMessageSchema>;
export interface CanvasRestoreDraftParticipant {
  readGeneration(): string | null;
  discard(): void;
}
