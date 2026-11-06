import type { CanvasRestoreDraftParticipant } from '../definitions/canvasHistoryRestoration';
export function createCanvasDraftDiscard(options: {
  readonly participants: readonly CanvasRestoreDraftParticipant[];
  readonly saving: () => boolean;
  readonly changed: () => void;
  readonly focus: () => void;
}) {
  return () => {
    if (options.saving()) throw new Error('请先等待保存或确认结果，再使用已保存内容');
    for (const participant of options.participants)
      if (participant.readGeneration() !== null) participant.discard();
    options.changed();
    options.focus();
  };
}
