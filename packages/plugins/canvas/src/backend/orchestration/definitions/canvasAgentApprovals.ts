import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import type { CanvasCommitActor, CanvasHistoryCommitInput } from '../../features/canvasCommit';
import type { CanvasPendingBatch, CanvasAgentGroupStart } from '../../features/agentChanges';
import type { CanvasCommitResult, CanvasAgentCommitResult } from '../../../shared';
export interface CanvasAgentApprovalOptions {
  readonly database: CanvasDatabase;
  readonly commit: (input: {
    request: unknown;
    actor: CanvasCommitActor;
    now: number;
    onCommit?: (input: CanvasHistoryCommitInput) => void;
  }) => CanvasCommitResult;
  readonly pruneGuards: (documentId: string) => void;
  readonly onPending?: (batch: CanvasPendingBatch) => void;
  readonly groupStarted?: (input: CanvasAgentGroupStart) => void;
}
export interface CanvasAgentWriteInput {
  readonly request: unknown;
  readonly actor: CanvasCommitActor;
  readonly now: number;
  readonly intent?: 'apply' | 'arrange';
  readonly payloadIdentity?: unknown;
}
export interface CanvasAgentReplayInput {
  readonly documentId: string;
  readonly requestId: string;
  readonly actor: CanvasCommitActor;
  readonly payloadIdentity: unknown;
}
export type CanvasAgentRequestReplay = (
  input: CanvasAgentReplayInput
) => CanvasAgentCommitResult | undefined;
