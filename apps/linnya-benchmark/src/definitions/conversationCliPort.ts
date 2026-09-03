import type {
  ConversationControlAcceptedReceipt,
  ConversationControlAuditResponse,
  ConversationControlErrorCode,
  ConversationControlMessagesResponse,
  ConversationControlProgressFrame,
  ConversationControlRespondResponse,
  ConversationControlStopResponse,
} from '@app/schemas';

export type BenchmarkConversationResult =
  | {
      readonly outcome: 'completed' | 'failed' | 'cancelled';
      readonly completedAt: number;
      readonly resultStatus: 'available';
      readonly finalAnswer: string | null;
    }
  | {
      readonly outcome: 'completed' | 'failed' | 'cancelled';
      readonly completedAt: number;
      readonly resultStatus: 'unavailable';
      readonly reason: 'run_not_completed' | 'final_answer_missing' | 'projection_preparing';
    };

export interface BenchmarkConversationCliPort {
  send(request: {
    readonly message: string;
    readonly projectId: string;
    readonly agentId: string;
    readonly modelId?: string;
    readonly reasoningEffort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  }): Promise<ConversationControlAcceptedReceipt>;
  watchStatus(request: {
    readonly conversationId: string;
    readonly runId: string;
    readonly timeoutMs: number;
  }): Promise<{
    readonly frames: readonly ConversationControlProgressFrame[];
    readonly timedOut: boolean;
  }>;
  approve(request: {
    readonly conversationId: string;
    readonly interactionId: string;
    readonly projectId: string;
  }): Promise<ConversationControlRespondResponse>;
  stop(request: {
    readonly conversationId: string;
    readonly runId: string;
    readonly reason: string;
  }): Promise<ConversationControlStopResponse>;
  result(conversationId: string, runId: string): Promise<BenchmarkConversationResult>;
  messages(conversationId: string): Promise<ConversationControlMessagesResponse>;
  audit(conversationId: string, runId: string): Promise<ConversationControlAuditResponse>;
}

export class BenchmarkConversationCliError extends Error {
  constructor(
    readonly code: ConversationControlErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly command?: string,
  ) {
    super(message);
    this.name = 'BenchmarkConversationCliError';
  }
}
