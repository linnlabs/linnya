import type { CanvasDatabase } from './canvasDatabase';
import type { createCanvasVersionHistoryRuntime } from '../features/canvasVersionHistory';
import type { createCanvasHistoryRuntime } from '../orchestration/history/createCanvasHistoryRuntime';
import type { DocumentVersionSummary } from '@app/schemas';
export interface CanvasVersionActionsOptions {
  readonly database: CanvasDatabase;
  readonly versions: ReturnType<typeof createCanvasVersionHistoryRuntime>;
  readonly editing: ReturnType<typeof createCanvasHistoryRuntime>;
  readonly hasView: (documentId: string, clientSessionId: string) => boolean;
  readonly restored: (event: {
    documentId: string;
    clientSessionId: string;
    sequence: number;
  }) => void;
}
export interface CanvasVersionRestorationActionOptions extends CanvasVersionActionsOptions {
  readonly list: (documentId: string) => DocumentVersionSummary[];
}
