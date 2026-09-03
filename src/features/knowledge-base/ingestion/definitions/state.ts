import type { ParseResult, StoreResult, VectorizeResult } from '../ingestionTypes';

/**
 * 内部业务状态 - 细粒度，用于摄入状态机控制。
 */
export enum InternalStage {
  PENDING = 'pending',
  PARSING = 'parsing',
  EMBEDDING = 'embedding',
  STORING = 'storing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DUPLICATE = 'duplicate',
}

/**
 * 前端展示状态 - 粗粒度，用于 UI 展示。
 */
export enum FrontendStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DUPLICATE = 'duplicate',
}

/**
 * 状态转换事件。
 */
export enum StateEvent {
  START_PROCESSING = 'start_processing',
  PARSING_COMPLETED = 'parsing_completed',
  EMBEDDING_COMPLETED = 'embedding_completed',
  STORING_COMPLETED = 'storing_completed',
  ERROR_OCCURRED = 'error_occurred',
  DUPLICATE_DETECTED = 'duplicate_detected',
}

/**
 * 任务上下文是状态机运行时实体，不应直接作为跨边界 DTO 暴露。
 */
export interface TaskContext {
  taskId: string;
  docId: string;
  kbId: string;
  filename: string;
  filePath: string;
  embeddingModelId: string;
  pdfOcrModelId?: string;
  imageVisionModelId?: string;
  visionModelId?: string;
  rerankModelId?: string;
  forceVisionMode?: boolean;
  parseResult?: ParseResult;
  vectorizeResult?: VectorizeResult;
  storeResult?: StoreResult;
  currentProgress: number;
  stageProgress: number;
  lastUpdated: number;
  errorMessage?: string;
}

export interface StateTransitionResult {
  success: boolean;
  newStage: InternalStage;
  context: TaskContext;
  message?: string;
  error?: string;
}

export interface IngestionFrontendState {
  readonly status: FrontendStatus;
  readonly stage: InternalStage;
  readonly progress: number;
  readonly stage_progress: number;
  readonly message: string;
  readonly error?: string;
  readonly doc_id: string;
  readonly filename: string;
  readonly updated_at: number;
}

export interface StateHandler {
  execute(context: TaskContext): Promise<StateTransitionResult>;
  getName(): string;
}

