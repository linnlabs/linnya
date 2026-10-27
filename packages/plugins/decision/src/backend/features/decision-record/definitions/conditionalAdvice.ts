import type { OptionState } from './optionRange';

export type ConditionalOutcome =
  | { readonly status: 'ranked_choice'; readonly optionIds: readonly string[] }
  | { readonly status: 'no_option_passes'; readonly optionIds: readonly []; readonly authorAction: string }
  | { readonly status: 'needs_information' | 'preference_needs_review'; readonly optionIds: readonly []; readonly authorAction: string }
  | { readonly status: 'selection_required'; readonly optionIds: readonly [] };

export interface ConditionalOptionState extends OptionState {
  readonly failedCheckIds: readonly string[];
  readonly unknownCheckIds: readonly string[];
}
