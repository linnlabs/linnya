import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import type { ReasoningEffort } from 'linnkit/contracts';

import type { ModelSelectOption } from '../../../definitions/modelSelectOption';

export const MANAGE_CONVERSATION_MODELS_VALUE = '__manage_conversation_models__';

export interface CurrentConversationModelPresentation {
  readonly id: string;
  readonly displayName: string;
  readonly imageInput: boolean;
}

export interface ConversationModelMenuLabels {
  readonly custom: string;
  readonly provider: string;
  readonly current: string;
  readonly manage: string;
  readonly imageUnsupported: string;
  readonly unavailable: string;
  readonly reasoning: string;
  readonly reasoningEfforts: Readonly<Record<ReasoningEffort, string>>;
}

export interface ConversationModelReasoningMenuInput {
  readonly currentEffort: ReasoningEffort | null;
  readonly supportedEffortsByModelId: Readonly<Record<string, readonly ReasoningEffort[]>>;
}

export interface ConversationModelMenuInput {
  readonly snapshot: ModelPickerSnapshot | null;
  readonly currentModel: CurrentConversationModelPresentation | null;
  readonly hasImageDrafts: boolean;
  readonly labels: ConversationModelMenuLabels;
  readonly reasoning: ConversationModelReasoningMenuInput;
}

export interface ConversationModelMenuProjection {
  readonly options: readonly ModelSelectOption[];
}
