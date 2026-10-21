import type {
  WebFailureKind,
  WebExtractionFailureStage,
  WebReadEscalationReason,
} from '@app/schemas';
import type { WebReadResult } from '../providers/types';

export type { WebReadEscalationReason, WebReadQualitySignal } from '@app/schemas';

/** 正文短缺的共同阈值；抽取候选选择与质量升级使用同一规则。 */
export const WEB_READ_SUBSTANTIAL_CONTENT_CHARS = 800;

export interface WebReadQualityAssessment {
  shouldEscalate: boolean;
  reason?: WebReadEscalationReason;
  qualityScore?: number;
}

export interface WebReadLadderResult {
  readResult: WebReadResult;
  initialProvider: string;
  selectedProvider: string;
  /** 是否实际执行过本地 Chromium 渲染，不包含直接跳过渲染的托管升级。 */
  renderAttempted: boolean;
  escalated: boolean;
  escalationReason?: WebReadEscalationReason;
  /** 本地 HTTP 首跳失败后进入后续层时，保留最初的真实失败分类。 */
  initialFailureKind?: WebFailureKind;
  /** 抽取失败的内部阶段；用于解释为什么尝试或跳过了 Chromium。 */
  initialFailureStage?: WebExtractionFailureStage;
}
