import type { CanvasElement, CanvasElementId, CanvasSource, CanvasOperationFieldResult } from '../../../../shared';
import type {
  CanvasCommitActor, CanvasCommitState, CanvasEditingClaim, CanvasElementChange, CanvasStoredElement,
} from '../../../features/canvasCommit';
import type { CanvasHistoryChange, CanvasHistoryEntry } from './canvasHistory';

export interface CanvasHistoryReversalInput {
  readonly state: CanvasCommitState;
  readonly entry: CanvasHistoryEntry;
  readonly actor: CanvasCommitActor;
  readonly claims: readonly CanvasEditingClaim[];
  readonly origin: string;
  readonly now: number;
}

/** 单条历史片段只读取当前计划状态；状态应用统一留在计划器。 */
export interface CanvasHistoryReversalContext {
  readonly rows: ReadonlyMap<CanvasElementId, CanvasStoredElement>;
  readonly deletedOrigins: CanvasCommitState['deletedOrigins'];
  readonly actor: CanvasCommitActor;
  readonly claims: readonly CanvasEditingClaim[];
  readonly origin: string;
  readonly now: number;
}
export type CanvasHistoryCreation = CanvasHistoryChange & { before: null; after: CanvasElement };
export type CanvasHistoryDeletion = CanvasHistoryChange & { before: CanvasElement; after: null };
export type CanvasHistoryEdit = CanvasHistoryChange & { before: CanvasElement; after: CanvasElement };
export type CanvasHistoryReversibleChange = CanvasHistoryCreation | CanvasHistoryDeletion | CanvasHistoryEdit;
export type CanvasHistoryReversalDecision =
  | { readonly kind: 'skipped'; readonly reason: string; readonly fieldResults?: readonly CanvasOperationFieldResult[] }
  | {
    readonly kind: 'applied';
    readonly row: CanvasStoredElement | null;
    readonly change: CanvasElementChange;
    readonly reason: string | null;
    readonly fieldResults?: readonly CanvasOperationFieldResult[];
    readonly deletionGuard?: CanvasCommitState['deletedOrigins'][string];
  };
export interface CanvasHistoryRestorationMetadata {
  readonly source: CanvasSource;
  readonly now: number;
  readonly revision: number;
}

export interface CanvasHistoryRestorationPlacementInput {
  readonly rows: ReadonlyMap<CanvasElementId, CanvasStoredElement>;
  readonly changes: readonly CanvasElementChange[];
  readonly results: import('../../../features/canvasCommit').CanvasCommitPlan['results'];
  readonly restorationResults: ReadonlyMap<CanvasElementId, number>;
  readonly origin: string;
}
