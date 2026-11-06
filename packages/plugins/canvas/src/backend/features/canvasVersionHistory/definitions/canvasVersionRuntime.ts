import type { DocumentVersionSummary } from '@app/schemas';
import type { CanvasSnapshot } from '../../../../shared';
import type { createCanvasVersionRepository } from '../persistence/canvasVersionRepository';
import type {
  CanvasVersionHistoryOptions,
  CanvasVersionHead,
  CanvasVersionBudgetStatus,
} from './canvasVersionHistory';
export interface CanvasCheckpointInput {
  readonly documentId: string;
  readonly reason:
    | 'initialize'
    | 'idle'
    | 'interval'
    | 'close'
    | 'agent-group'
    | 'restore'
    | 'migration';
  readonly now?: number;
  readonly snapshot?: CanvasSnapshot;
  readonly restoredFrom?: DocumentVersionSummary['restoredFrom'];
}
export interface CanvasVersionRuntimeDependencies extends CanvasVersionHistoryOptions {
  readonly repository: ReturnType<typeof createCanvasVersionRepository>;
  readonly now: () => number;
  readonly budgetBytes: number;
}
export interface CanvasVersionHeadReader {
  readonly requiredHead: (documentId: string) => CanvasVersionHead;
}
export interface CanvasVersionBudgetObserver {
  readonly budgetStatus: (documentId: string) => CanvasVersionBudgetStatus;
  readonly notifyBudget: (status: CanvasVersionBudgetStatus) => void;
  readonly report: (documentId: string, error: unknown) => void;
}
