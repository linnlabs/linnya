import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import type {
  CanvasCommitPorts,
  CanvasHistoryCommitInput,
  CanvasCommitContext,
  CanvasCommitState,
  CanvasCommitActor,
} from '../../features/canvasCommit';
import type { CanvasAgentGroupStart, CanvasPendingBatch } from '../../features/agentChanges';
import type { createCanvasUserHistoryState } from '../../features/canvasUndoHistory';
export interface CanvasHistoryRuntimeOptions {
  readonly database: CanvasDatabase;
  readonly ports?: CanvasCommitPorts;
  readonly maxEntries?: number;
  readonly groupsChanged?: (documentId: string, reason: 'write' | 'review' | 'release') => void;
  readonly groupStarted?: (input: CanvasAgentGroupStart) => void;
  readonly pendingApproval?: (batch: CanvasPendingBatch) => void;
}
export interface CanvasHistoryPortsInput {
  readonly historyGroupId?: string;
  readonly onCommit?: (history: CanvasHistoryCommitInput) => void;
  readonly beforeHistory?: (history: CanvasHistoryCommitInput) => void;
}
export type CanvasHistoryViewState = ReturnType<typeof createCanvasUserHistoryState>;
export interface CanvasHistoryRetentionOptions
  extends Pick<CanvasHistoryRuntimeOptions, 'database' | 'ports'> {
  readonly userState: CanvasHistoryViewState;
  readonly notifyGroups: (documentId: string, reason: 'write' | 'review' | 'release') => void;
}
export interface CanvasUserUndoOptions
  extends Pick<CanvasHistoryRuntimeOptions, 'database' | 'ports' | 'maxEntries'> {
  readonly userState: CanvasHistoryViewState;
  readonly pruneGuards: (documentId: string) => void;
}
export interface CanvasHistoryCommitPortsOptions
  extends Pick<CanvasHistoryRuntimeOptions, 'database' | 'groupStarted'> {
  readonly outer?: CanvasCommitPorts;
  readonly reservedRectangles: (
    state: CanvasCommitState,
    context: CanvasCommitContext
  ) => ReturnType<NonNullable<CanvasCommitPorts['reservedRectangles']>>;
  readonly input: CanvasHistoryPortsInput;
  readonly recordUserHistory: (
    history: CanvasHistoryCommitInput,
    groupId?: string | null
  ) => (() => void) | undefined;
}

export interface CanvasHistoryPreviewInput {
  readonly request: unknown;
  readonly actor: CanvasCommitActor;
  readonly now: number;
}
