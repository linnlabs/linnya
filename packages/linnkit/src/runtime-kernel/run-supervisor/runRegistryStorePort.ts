export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ListRunsFilter = {
  conversationId?: string;
  status?: RunStatus | RunStatus[];
  parentRunId?: RunId;
  agentSpecId?: string;
  startedAfter?: number;
  startedBefore?: number;
  limit?: number;
  cursor?: string;
};

export type RunRecord = {
  runId: RunId;
  conversationId: string;
  parentRunId?: RunId;
  agentSpecId?: string;
  status: RunStatus;
  currentNode?: string;
  startedAt: number;
  updatedAt: number;
  pausedAt?: number;
  pauseReason?: string;
  iterationsUsed?: number;
  iterationBudget?: { max: number; refundable: boolean };
  errorIfAny?: { errorCode: string; message: string; recoverable: boolean };
  metadata?: Record<string, unknown>;
};

export interface RunRegistryStore {
  save(record: RunRecord): Promise<void>;
  load(runId: RunId): Promise<RunRecord | null>;
  list(filter?: ListRunsFilter): Promise<{ runs: RunRecord[]; nextCursor?: string }>;
  delete(runId: RunId): Promise<void>;
}
import type { RunId } from '../../contracts';
