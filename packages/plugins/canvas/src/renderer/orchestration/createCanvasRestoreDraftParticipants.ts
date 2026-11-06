import type { CanvasCardEditor } from '../features/cardEditing';
import type { createCanvasTextCreation } from '../features/textCreation';
import type { createCanvasConnectionEditing } from '../features/connections';
import type { CanvasRestoreDraftParticipant } from '../definitions/canvasHistoryRestoration';
export function createCanvasRestoreDraftParticipants(options: {
  readonly editor: CanvasCardEditor;
  readonly creation: ReturnType<typeof createCanvasTextCreation>;
  readonly connections: ReturnType<typeof createCanvasConnectionEditing>;
  readonly report: (failure: unknown) => void;
}): readonly CanvasRestoreDraftParticipant[] {
  return [
    {
      readGeneration: () => {
        const draft = options.editor.state.draft.value;
        return draft ? `${draft.historyGroupId}:${draft.editSequence}` : null;
      },
      discard() {
        void options.editor.suspend().catch(options.report);
        options.editor.state.clear();
      },
    },
    {
      readGeneration: () => {
        const draft = options.creation.state.draft.value;
        return draft ? `${draft.identity}:${draft.editSequence}` : null;
      },
      discard: options.creation.cancel,
    },
    {
      readGeneration: () => {
        const draft = options.connections.state.label.value;
        return draft ? `${draft.identity}:${draft.editSequence}` : null;
      },
      discard: options.connections.cancelLabel,
    },
  ];
}
