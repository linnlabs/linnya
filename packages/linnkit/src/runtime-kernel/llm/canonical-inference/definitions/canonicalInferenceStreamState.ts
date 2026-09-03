import type {
  CanonicalInferenceFailureKind,
  CanonicalInferenceFinishReason,
} from '../../../../ports';

export type CanonicalInferenceTerminal =
  | { readonly type: 'finish'; readonly reason: CanonicalInferenceFinishReason }
  | {
      readonly type: 'failure';
      readonly kind: CanonicalInferenceFailureKind;
      readonly code: string;
      readonly retryable: boolean;
    };

export interface OpenCanonicalToolCall {
  readonly index: number;
  readonly part_index: number;
  readonly id?: string;
  readonly name?: string;
}

export interface CanonicalInferenceStreamState {
  readonly phase: 'idle' | 'streaming' | 'terminal';
  readonly open_tool_calls: readonly OpenCanonicalToolCall[];
  readonly usage_seen: boolean;
  readonly assistant_part_indices: readonly number[];
  readonly terminal?: CanonicalInferenceTerminal;
}

export const INITIAL_CANONICAL_INFERENCE_STREAM_STATE: CanonicalInferenceStreamState = {
  phase: 'idle',
  open_tool_calls: [],
  usage_seen: false,
  assistant_part_indices: [],
};
