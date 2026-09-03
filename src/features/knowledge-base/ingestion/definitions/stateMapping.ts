import { FrontendStatus, InternalStage } from './state';

export const INTERNAL_TO_FRONTEND_STATUS_MAP: Record<InternalStage, FrontendStatus> = {
  [InternalStage.PENDING]: FrontendStatus.PENDING,
  [InternalStage.PARSING]: FrontendStatus.PROCESSING,
  [InternalStage.EMBEDDING]: FrontendStatus.PROCESSING,
  [InternalStage.STORING]: FrontendStatus.PROCESSING,
  [InternalStage.COMPLETED]: FrontendStatus.COMPLETED,
  [InternalStage.FAILED]: FrontendStatus.FAILED,
  [InternalStage.DUPLICATE]: FrontendStatus.DUPLICATE,
};

export const STAGE_TO_PROGRESS_MAP: Record<InternalStage, number> = {
  [InternalStage.PENDING]: 0,
  [InternalStage.PARSING]: 5,
  [InternalStage.EMBEDDING]: 85,
  [InternalStage.STORING]: 95,
  [InternalStage.COMPLETED]: 100,
  [InternalStage.FAILED]: 0,
  [InternalStage.DUPLICATE]: 100,
};

export const STAGE_MESSAGES: Record<InternalStage, string> = {
  [InternalStage.PENDING]: '等待中',
  [InternalStage.PARSING]: '解析中',
  [InternalStage.EMBEDDING]: '解析中',
  [InternalStage.STORING]: '解析中',
  [InternalStage.COMPLETED]: '已完成',
  [InternalStage.FAILED]: '失败',
  [InternalStage.DUPLICATE]: '重复文件',
};

export const STATE_TRANSITION_RULES: Record<InternalStage, InternalStage[]> = {
  [InternalStage.PENDING]: [
    InternalStage.PARSING,
    InternalStage.DUPLICATE,
    InternalStage.FAILED,
  ],
  [InternalStage.PARSING]: [
    InternalStage.EMBEDDING,
    InternalStage.FAILED,
  ],
  [InternalStage.EMBEDDING]: [
    InternalStage.STORING,
    InternalStage.FAILED,
  ],
  [InternalStage.STORING]: [
    InternalStage.COMPLETED,
    InternalStage.FAILED,
  ],
  [InternalStage.COMPLETED]: [],
  [InternalStage.FAILED]: [],
  [InternalStage.DUPLICATE]: [],
};

