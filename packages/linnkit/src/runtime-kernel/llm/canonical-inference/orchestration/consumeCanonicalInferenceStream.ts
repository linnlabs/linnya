import type { CanonicalInferenceEvent } from '../../../../ports';
import {
  INITIAL_CANONICAL_INFERENCE_STREAM_STATE,
  type CanonicalInferenceStreamState,
  type CanonicalInferenceTerminal,
} from '../definitions/canonicalInferenceStreamState';
import { advanceCanonicalInferenceStreamState } from '../functions/advanceCanonicalInferenceStreamState';

export async function consumeCanonicalInferenceStream(
  events: AsyncIterable<CanonicalInferenceEvent>,
  onEvent: (event: CanonicalInferenceEvent) => void
): Promise<CanonicalInferenceTerminal> {
  let state: CanonicalInferenceStreamState = INITIAL_CANONICAL_INFERENCE_STREAM_STATE;
  for await (const event of events) {
    state = advanceCanonicalInferenceStreamState(state, event);
    onEvent(event);
  }
  if (!state.terminal) {
    throw new Error('[CanonicalInference] stream 在 terminal event 前结束。');
  }
  return state.terminal;
}
