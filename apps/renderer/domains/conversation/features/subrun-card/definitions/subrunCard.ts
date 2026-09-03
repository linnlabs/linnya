import type { AnswerSegmentState } from '../../answer-segment';
import type { ConversationToolMessageStatus } from '@app/schemas';
import type { SubagentStatus } from '@app/schemas';
import type { SubRunTraceToolCallDecision } from '@linnlabs/linnkit/contracts';
import type { ConversationCitationProjectionWorkspace } from '../../citation-presentation';

export type SubrunCardStatus = 'loading' | 'success' | 'error';

export interface SubrunCardPresentationData {
  readonly description: string;
  readonly status: SubrunCardStatus;
  readonly subrunId?: string;
  readonly subagentType?: string;
  readonly modelId?: string;
  readonly outcome?: SubagentStatus;
}

/** SubrunCard 只消费 admission 后的数据与生命周期，不读取工具 raw payload。 */
export interface SubrunCardPresentation {
  readonly data: SubrunCardPresentationData;
  readonly status: ConversationToolMessageStatus;
}

export type SubrunStepStatus = 'loading' | 'success' | 'error';

export interface SubrunAnswerProjectionState extends AnswerSegmentState {
  readonly turnId: string;
  messageIndex: number | undefined;
}

export interface SubrunToolDecision {
  readonly toolName: string;
  readonly args: SubRunTraceToolCallDecision['args'];
  readonly turnId: string;
  readonly timestamp: number;
}

export type SubrunTraceProjectionResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: string };

export interface SubrunMessageProjectionState {
  citationWorkspace: ConversationCitationProjectionWorkspace;
  readonly toolMessageIndexByCallId: Map<string, number>;
  readonly toolDecisionByCallId: Map<string, SubrunToolDecision>;
  currentThoughtMessageIndex: number | undefined;
  thoughtSequence: number;
  readonly answerStateById: Map<string, SubrunAnswerProjectionState>;
  subrunId: string;
  currentThoughtStartedAt: number | undefined;
}
