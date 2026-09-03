import type { InjectionKey } from 'vue';
import type { BaseMessage } from '../../../../../types';

export interface RenderedAnswerTransferSession {
  readonly answerMessageIds: readonly string[];
  readonly containerEl: HTMLElement;
  readonly plainText: string;
}

export interface RenderedAnswerTransferRequest {
  readonly answers: readonly BaseMessage[];
}

export interface RenderedAnswerTransferPort {
  withRenderedAnswers<TResult>(
    request: RenderedAnswerTransferRequest,
    consume: (session: RenderedAnswerTransferSession) => Promise<TResult> | TResult,
  ): Promise<TResult>;
}

export const RENDERED_ANSWER_TRANSFER_PORT_KEY: InjectionKey<RenderedAnswerTransferPort> =
  Symbol('conversation:rendered-answer-transfer');
