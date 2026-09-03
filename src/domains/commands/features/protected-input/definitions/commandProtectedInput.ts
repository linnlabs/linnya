import type {
  CommandExecutionOwnerBindingV1,
  ProcessInteractionRejectionCode,
} from '@app/schemas/commands';

export interface CommandProtectedInputRequest {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly input: string;
}

export type CommandProtectedInputRejectionCode = Extract<
  ProcessInteractionRejectionCode,
  'stdin_closed' | 'interaction_failed' | 'action_not_supported' | 'input_budget_exceeded'
> | 'owner_ending' | 'owner_ended' | 'incompatible_state';

export type CommandProtectedInputResult =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected';
      readonly code: CommandProtectedInputRejectionCode;
    };
