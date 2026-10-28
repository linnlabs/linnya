import type { SkillManagementPort } from 'src/features/skills';
import type { ProjectLifecyclePort } from 'src/domains/projects';
import type { ConversationControlSkillsResponse } from '@app/schemas';
import type {
  ConversationControlCommandApprovalsRequest,
  ConversationControlCommandApprovalsResponse,
  ConversationControlAuditRequest,
  ConversationControlAuditResponse,
  ConversationControlCommandRequest,
  ConversationControlListRequest,
  ConversationControlListResponse,
  ConversationControlModelSummary,
  ConversationControlModelsRequest,
  ConversationControlProjectsRequest,
  ConversationControlProjectsResponse,
  ConversationControlModelsResponse,
  ConversationControlMessagesRequest,
  ConversationControlMessagesResponse,
  ConversationControlRespondRequest,
  ConversationControlRespondResponse,
  ConversationControlResumeRequest,
  ConversationControlResumeResponse,
  ConversationControlResultRequest,
  ConversationControlResultResponse,
  ConversationControlSendRequest,
  ConversationControlSendResponse,
  ConversationControlStatusRequest,
  ConversationControlStatusResponse,
  ConversationControlStopRequest,
  ConversationControlStopResponse,
  ConversationControlToolDescriptor,
  ConversationControlToolName,
  ConversationControlToolsRequest,
  ConversationControlToolsResponse,
  ConversationHistoryListItem,
  ConversationInteractionResponseRequest,
  ConversationNextRequest,
  ConversationRunContinueRequest,
  ConversationRunCancelResponse,
  ConversationSelectedAgentId,
  ConversationUiMessage,
} from '@app/schemas';
import type { CommandApprovalControlPort } from 'src/domains/commands';
import type { ExecutionAuditExportUseCase } from '../../execution-audit-export';
import type {
  ModelRuntimeAvailability,
  SelectableModelCapability,
} from '../../model-runtime-availability';

export interface ConversationControlFlowAcceptance {
  readonly conversationId: string;
  readonly incomingEventIds: readonly string[];
  readonly turnId: string;
  readonly runId: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly acceptedAt: number;
}

export interface ConversationControlFlowPort {
  start(request: ConversationNextRequest): Promise<ConversationControlFlowAcceptance>;
  respond(
    request: ConversationInteractionResponseRequest
  ): Promise<ConversationControlFlowAcceptance>;
  resume(
    runId: string,
    request: ConversationRunContinueRequest
  ): Promise<ConversationControlFlowAcceptance>;
  stop(
    runId: string,
    conversationId: string,
    reason: string
  ): Promise<ConversationRunCancelResponse>;
}

export interface ConversationControlRunRecord {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly agentSpecId?: string;
  readonly conversationId: string;
  readonly status:
    | 'pending'
    | 'running'
    | 'awaiting_user'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly currentNode?: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly pausedAt?: number;
  readonly pauseReason?: string;
  /** 当前 execution 的 Graph 步数；有生命周期观测时提供，不能用累计 checkpoint 冒认。 */
  readonly executionStepsUsed?: number;
  /** 同一逻辑 run 跨 execution 的累计步数。 */
  readonly runIterationsUsed?: number;
  readonly iterationsUsed?: number;
  readonly errorIfAny?: {
    readonly errorCode: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface ConversationControlRunPort {
  findByConversation(conversationId: string): Promise<readonly ConversationControlRunRecord[]>;
}

export interface ConversationControlExecutionProgressSnapshot {
  readonly savedAt: number;
  readonly currentNode?: string;
  readonly runIterationsUsed?: number;
}

export interface ConversationControlExecutionProgressPort {
  read(runId: string): Promise<ConversationControlExecutionProgressSnapshot | null>;
  /** 终态 checkpoint 已清理时，从保留的 execution telemetry 读取最近一次执行步数。 */
  readLatestExecutionSteps?(conversationId: string, runId: string): Promise<number | undefined>;
}

export interface ConversationControlModelCatalogPort {
  list(): {
    readonly chat: readonly ConversationControlModelSummary[];
    readonly imageGeneration: readonly ConversationControlModelSummary[];
  };
  evaluate(
    modelId: string,
    capability: SelectableModelCapability
  ): ModelRuntimeAvailability | undefined;
}

export type ConversationControlMessageWindow =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly messages: readonly ConversationUiMessage[];
      readonly has_more_before: boolean;
      readonly has_more_after: boolean;
      readonly prev_cursor?: number;
      readonly next_cursor?: number;
      readonly revision: number;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    }
  | {
      readonly status: 'anchor-not-found';
      readonly conversation_id: string;
      readonly anchor_message_id: string;
    };

export type ConversationControlRunFinalAnswer =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly message: Extract<ConversationUiMessage, { message_type: 'final_answer' }> | null;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    };

export interface ConversationControlHistoryPort {
  list(query: {
    readonly limit: number;
    readonly cursor?: string;
    readonly search?: string;
    readonly projectId?: string;
  }): Promise<{
    readonly conversations: readonly ConversationHistoryListItem[];
    readonly next_cursor?: string;
    readonly has_more: boolean;
  }>;
  readTail(conversationId: string, limit: number): Promise<ConversationControlMessageWindow>;
  readBefore(
    conversationId: string,
    cursor: number,
    limit: number
  ): Promise<ConversationControlMessageWindow>;
  readAfter(
    conversationId: string,
    cursor: number,
    limit: number
  ): Promise<ConversationControlMessageWindow>;
  readRunFinalAnswer(
    conversationId: string,
    runId: string
  ): Promise<ConversationControlRunFinalAnswer>;
  readConversationProjectId(conversationId: string): Promise<string | null | undefined>;
  readSelectedAgent(conversationId: string): Promise<ConversationSelectedAgentId | null>;
  updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId,
    projectId?: string
  ): Promise<boolean>;
}

export interface ConversationControlToolCatalogPort {
  describe(
    toolNames: readonly ConversationControlToolName[]
  ): readonly ConversationControlToolDescriptor[];
}

export interface ConversationControlUseCasePorts {
  readonly skills?: SkillManagementPort;
  readonly flow: ConversationControlFlowPort;
  readonly runs: ConversationControlRunPort;
  readonly executionProgress: ConversationControlExecutionProgressPort;
  readonly models: ConversationControlModelCatalogPort;
  readonly projects: Pick<ProjectLifecyclePort, 'list' | 'get' | 'create' | 'update'>;
  readonly history: ConversationControlHistoryPort;
  readonly tools: ConversationControlToolCatalogPort;
  readonly audit: ExecutionAuditExportUseCase;
  readonly commandApprovals: CommandApprovalControlPort;
  /** 生产 Host 关闭开发 Agent Run Audit 时，控制面必须显式返回 capability_unavailable。 */
  readonly auditAvailable?: boolean;
  readonly createConversationId: () => string;
  readonly now: () => number;
}

export interface ConversationControlUseCase {
  execute(
    request: ConversationControlCommandRequest
  ): Promise<
    | ConversationControlSkillsResponse
    | ConversationControlCommandApprovalsResponse
    | ConversationControlSendResponse
    | ConversationControlModelsResponse
    | ConversationControlProjectsResponse
    | ConversationControlListResponse
    | ConversationControlMessagesResponse
    | ConversationControlStatusResponse
    | ConversationControlResumeResponse
    | ConversationControlRespondResponse
    | ConversationControlStopResponse
    | ConversationControlResultResponse
    | ConversationControlAuditResponse
    | ConversationControlToolsResponse
  >;
  commandApprovals(request: ConversationControlCommandApprovalsRequest): Promise<ConversationControlCommandApprovalsResponse>;
  send(request: ConversationControlSendRequest): Promise<ConversationControlSendResponse>;
  projects(
    request: ConversationControlProjectsRequest
  ): Promise<ConversationControlProjectsResponse>;
  models(request: ConversationControlModelsRequest): Promise<ConversationControlModelsResponse>;
  list(request: ConversationControlListRequest): Promise<ConversationControlListResponse>;
  messages(
    request: ConversationControlMessagesRequest
  ): Promise<ConversationControlMessagesResponse>;
  status(request: ConversationControlStatusRequest): Promise<ConversationControlStatusResponse>;
  resume(request: ConversationControlResumeRequest): Promise<ConversationControlResumeResponse>;
  respond(request: ConversationControlRespondRequest): Promise<ConversationControlRespondResponse>;
  stop(request: ConversationControlStopRequest): Promise<ConversationControlStopResponse>;
  result(request: ConversationControlResultRequest): Promise<ConversationControlResultResponse>;
  audit(request: ConversationControlAuditRequest): Promise<ConversationControlAuditResponse>;
  tools(
    request: ConversationControlToolsRequest
  ): Promise<ConversationControlToolsResponse>;
}
