import type {
  ConversationControlAcceptedReceipt,
  ConversationControlAuditResponse,
  ConversationControlProgressFrame,
  ConversationControlRespondResponse,
  ConversationControlStopResponse,
} from '@app/schemas';
import type { ResolvedBenchmarkCase } from './benchmarkCase';
import type { BenchmarkConversationResult } from './conversationCliPort';

export type BenchmarkRunOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'requires_user'
  | 'requires_recovery'
  | 'runner_failed';

export interface BenchmarkRunError {
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface BenchmarkMessageSummary {
  readonly status: 'ready' | 'preparing';
  readonly count?: number;
  readonly byType?: Readonly<Record<string, number>>;
  readonly latestMessageId?: string;
  readonly revision?: number;
}

export interface BenchmarkRunFacts {
  readonly schemaVersion: 1;
  readonly benchmark: {
    readonly id: string;
    readonly revision: number;
    readonly name: string;
    readonly tags: readonly string[];
    readonly artifactExpectation: string;
  };
  readonly configuration: {
    readonly projectId: string;
    readonly agentId: string;
    readonly modelId?: string;
    readonly reasoningEffort: string;
    readonly timeoutMs: number;
    readonly inputs: Readonly<Record<string, string>>;
  };
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly outcome: BenchmarkRunOutcome;
  readonly receipt?: ConversationControlAcceptedReceipt;
  readonly statusFrames: readonly ConversationControlProgressFrame[];
  readonly interactionResponses: readonly ConversationControlRespondResponse[];
  readonly stop?: ConversationControlStopResponse;
  readonly result?: BenchmarkConversationResult;
  readonly messages?: BenchmarkMessageSummary;
  readonly audit:
    | { readonly status: 'available'; readonly response: ConversationControlAuditResponse }
    | { readonly status: 'unavailable'; readonly code: string; readonly message: string }
    | { readonly status: 'not_requested' };
  readonly errors: readonly BenchmarkRunError[];
}

export interface RunBenchmarkCaseRequest {
  readonly benchmark: ResolvedBenchmarkCase;
  readonly projectId: string;
  readonly modelId?: string;
  readonly reasoningEffort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface BenchmarkReportLocation {
  readonly directory: string;
  readonly factsFile: string;
  readonly reportFile: string;
}

export interface BenchmarkReportPort {
  write(input: {
    readonly benchmark: ResolvedBenchmarkCase;
    readonly facts: BenchmarkRunFacts;
    readonly outputRoot?: string;
  }): Promise<BenchmarkReportLocation>;
}
