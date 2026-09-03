export interface LLMAuditContext {
  conversationId: string;
  runId: string;
  traceId?: string;
  subrunId?: string;
  parentToolCallId?: string;
  source?: string;
}

export type ContextManagerAuditStage = 'before_context_manager' | 'after_context_manager';

export interface ContextManagerAuditEntry {
  seq: number;
  stage: ContextManagerAuditStage;
  timestamp: number;
  at: string;
  audit_context?: {
    conversationId: string;
    runId: string;
    traceId?: string;
    subrunId?: string;
    parentToolCallId?: string;
    source?: string;
  };
  payload: unknown;
}

export interface RunTranscriptAuditEntry {
  seq: number;
  stage: 'run_transcript';
  timestamp: number;
  at: string;
  audit_context?: ContextManagerAuditEntry['audit_context'];
  payload: {
    transcriptMessages: unknown[];
    toolset?: {
      availableTools?: string[];
    };
  };
}

export interface LlmInputMaterializationAuditInput {
  readonly activeModelId: string;
  readonly profileId: string;
  readonly estimatorVersion: string;
  readonly apiSurface: string;
  readonly inputBudget: number;
  readonly nonImageEstimatedTokens: number;
  readonly attachmentEvidence: readonly {
    readonly messageIndex: number;
    readonly attachmentIndex: number;
    readonly id: string;
    readonly resourceId: string;
    readonly placement: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
  }[];
}

export interface LlmInputMaterializationAuditEntry {
  seq: number;
  stage: 'llm_input_materialization';
  timestamp: number;
  at: string;
  audit_context?: ContextManagerAuditEntry['audit_context'];
  payload: {
    active_model_id: string;
    profile_id: string;
    estimator_version: string;
    api_surface: string;
    input_budget: number;
    non_image_estimated_tokens: number;
    attachment_evidence: LlmInputMaterializationAuditInput['attachmentEvidence'];
  };
}

export interface ToolProtocolErrorAuditEntry {
  seq: number;
  stage: 'tool_protocol_error';
  timestamp: number;
  at: string;
  audit_context?: ContextManagerAuditEntry['audit_context'];
  payload: {
    tool_call: {
      toolName: string;
      toolCallId?: string;
      rawArguments?: string;
      rawArgumentsSummary?: {
        length: number;
        head: string;
        tail: string;
      };
      parsedArguments?: Record<string, unknown>;
    };
    protocol_error: {
      message: string;
    };
    llm_request: {
      contextMessages?: unknown[];
      llmMessages?: unknown[];
      tool_names?: string[];
    };
  };
}

export interface ToolProtocolErrorReplayInput {
  fixtureId: string;
  audit_context?: ContextManagerAuditEntry['audit_context'];
  toolName: string;
  toolCallId?: string;
  contextMessages?: unknown[];
  messages: unknown[];
  tool_names?: string[];
  expected_error: string;
  original_tool_call: {
    rawArguments?: string;
    rawArgumentsSummary?: {
      length: number;
      head: string;
      tail: string;
    };
    parsedArguments?: Record<string, unknown>;
  };
}

export interface RunAuditBucket {
  before?: ContextManagerAuditEntry;
  after?: ContextManagerAuditEntry;
  latestAfterForReplay?: ContextManagerAuditEntry;
  systemReminderAfterSnapshots?: ContextManagerAuditEntry[];
  systemReminderAfterSnapshotsDroppedCount?: number;
  transcript?: RunTranscriptAuditEntry;
  materializationAttempts?: LlmInputMaterializationAuditEntry[];
  toolProtocolErrors?: ToolProtocolErrorAuditEntry[];
  toolProtocolErrorsDroppedCount?: number;
}

export interface RunAuditPaths {
  baseDir: string;
  beforePath: string;
  afterPath: string;
  toolProtocolErrorsPath: string;
  checkpointPath: string;
}

export interface RunAuditState {
  startedAtIso: string;
  seq: number;
  byRunKey: Record<string, RunAuditBucket>;
  flushed: boolean;
  checkpoint: {
    writeQueue: Promise<void>;
    debounceTimer?: NodeJS.Timeout;
    maxIntervalTimer?: NodeJS.Timeout;
    lastEnqueuedSeq: number;
    lastWrittenSeq: number;
    pathsPromise?: Promise<RunAuditPaths>;
  };
}

export interface LLMAuditStore {
  stack: LLMAuditContext[];
  runAudit?: RunAuditState;
}

export interface AuditDocumentCommonMetadata {
  startedAt: string;
  startedAtBeijing: string;
  flushedAt: string;
  flushedAtBeijing: string;
  audit_context?: ContextManagerAuditEntry['audit_context'];
}
