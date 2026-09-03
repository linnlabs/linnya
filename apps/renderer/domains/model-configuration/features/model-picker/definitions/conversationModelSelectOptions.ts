import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

export interface ConversationModelSelectOptionLabels {
  readonly providerGroup: string;
  readonly customGroup: string;
  readonly unavailable: string;
}

export interface BuildConversationModelSelectOptionsInput {
  readonly snapshot: ModelPickerSnapshot | null;
  readonly labels: ConversationModelSelectOptionLabels;
}

export interface BuildPurposeModelSelectOptionsInput
  extends BuildConversationModelSelectOptionsInput {
  readonly capability: string;
}

export type ConversationModelSelectOption = CustomSelectOption<string>;
