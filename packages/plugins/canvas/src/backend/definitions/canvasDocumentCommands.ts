import type { CanvasDatabase } from './canvasDatabase';
import type { createCanvasViewLifecycle } from '../features/canvasDocument';
import type { createCanvasHistoryRuntime } from '../orchestration/history/createCanvasHistoryRuntime';
import type { createCanvasVersionHistoryRuntime } from '../features/canvasVersionHistory';
import type { createCanvasTextSnapshots } from '../orchestration/createCanvasTextSnapshots';
export interface CanvasDocumentQueryDependencies {
  readonly database: CanvasDatabase;
  readonly assertActive: () => void;
  readonly views: ReturnType<typeof createCanvasViewLifecycle>;
  readonly editing: ReturnType<typeof createCanvasHistoryRuntime>;
}
export interface CanvasDocumentWriteDependencies extends CanvasDocumentQueryDependencies {
  readonly versions: ReturnType<typeof createCanvasVersionHistoryRuntime>;
  readonly textSnapshots: ReturnType<typeof createCanvasTextSnapshots>;
}
