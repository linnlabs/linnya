import type {
  AskQuestion,
  AskInput,
  QuestionnaireAnswers,
  QuestionnaireData,
} from '@app/schemas';

export type Question = AskQuestion;
export type QuestionnaireViewData = Omit<QuestionnaireData, 'questionnaireId'> & {
  /** args 预览尚未获得后端正式问卷身份，因此明确为 null，且不可提交。 */
  questionnaireId: string | null;
};

export type QuestionnaireStatus =
  | { type: 'active' }
  | { type: 'submitted'; timestamp?: number; userAnswers: QuestionnaireAnswers }
  | { type: 'skipped'; timestamp?: number };

export type AskPresentationInteraction =
  | { readonly type: 'pending' }
  | { readonly type: 'active' }
  | { readonly type: 'submitted'; readonly timestamp?: number; readonly userAnswers: QuestionnaireAnswers }
  | { readonly type: 'skipped'; readonly timestamp?: number };

export type AskPresentationQuestionnaire =
  | { readonly kind: 'placeholder' }
  | { readonly kind: 'preview'; readonly data: AskInput }
  | { readonly kind: 'canonical'; readonly data: QuestionnaireData };

export interface AskPresentationData {
  readonly toolCallId: string;
  readonly toolName: 'ask' | 'ask_questions';
  readonly questionnaire: AskPresentationQuestionnaire;
  readonly interaction: AskPresentationInteraction;
}

export type ValidationErrors = Record<string, string>;
export type Answers = Record<string, string>;
export type MultiAnswers = Record<string, string[]>;
export type TextAnswers = Record<string, string>;
export type OtherAnswers = Record<string, string>;
