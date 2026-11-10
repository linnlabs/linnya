import type { CanvasRestoreDraftParticipant } from '../definitions/canvasHistoryRestoration';
import { canvasText } from '../features/localization';
export function createCanvasDraftDiscard(options: {
  readonly participants: readonly CanvasRestoreDraftParticipant[];
  readonly saving: () => boolean;
  readonly changed: () => void;
  readonly focus: () => void;
}) {
  return () => {
    if (options.saving()) throw new Error(canvasText('canvas.error.waitBeforeDiscard'));
    for (const participant of options.participants)
      if (participant.readGeneration() !== null) participant.discard();
    options.changed();
    options.focus();
  };
}
