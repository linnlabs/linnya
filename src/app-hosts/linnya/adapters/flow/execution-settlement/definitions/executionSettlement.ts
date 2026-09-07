import type {
  ContextUsageSnapshot,
  RoutedRuntimeEvent,
  RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import type { graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';

export type WaitUserRuntimeEvent = Extract<RoutedRuntimeEvent, { type: 'requires_user_interaction' }>;

export type ExecutionSettlementRunHandle = Pick<
  runSupervisor.RunHandle<AgentInvokeRequest>,
  'runId' | 'markAwaitingUser' | 'markCompleted' | 'markFailed' | 'cancel'
>;

export interface ExecutionSettlementScope {
  readonly conversationId: string;
  readonly turnId: string;
  readonly executionId: string;
  readonly executionStartedAtMs: number;
  readonly userMessageId?: string;
}

export interface ExecutionSettlementPorts {
  readonly publishRuntimeEvent: (event: RuntimeEvent, source: string) => RoutedRuntimeEvent;
  readonly drainPersistence: () => Promise<void>;
  readonly runHandle: ExecutionSettlementRunHandle;
  /** 读取同一逻辑 run 在本 execution 前已经累计的步数。 */
  readonly readRunIterationsUsed?: () => Promise<number | undefined>;
  readonly clearCheckpoint: (runId: string) => Promise<void>;
  readonly releaseRunResources: (runId: string) => void;
  readonly now: () => number;
}

export interface SuccessfulExecutionSettlement {
  readonly checkpointNodeId: string;
  readonly stepCount: number;
  readonly waitUserEvent?: WaitUserRuntimeEvent;
  readonly contextUsage?: ContextUsageSnapshot;
}

export type FailedExecutionSettlement =
  | {
      readonly kind: 'cancelled';
      readonly stepCount: number;
      readonly abortReason?: unknown;
      readonly contextUsage?: ContextUsageSnapshot;
    }
  | {
      readonly kind: 'failed';
      readonly stepCount: number;
      readonly failureFact: graph.RuntimeFailureFact;
      readonly contextUsage?: ContextUsageSnapshot;
    };

export interface ExecutionSettlementOrchestration {
  settleSuccessfulExecution(input: SuccessfulExecutionSettlement): Promise<void>;
  settleFailedExecution(input: FailedExecutionSettlement): Promise<void>;
}
