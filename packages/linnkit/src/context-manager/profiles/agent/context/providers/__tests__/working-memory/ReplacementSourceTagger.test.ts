import { describe, expect, it } from 'vitest';

import { AiMessage } from '../../../../../../../contracts';
import type { MessageProcessingState } from '../../base';
import { ReplacementSourceTagger } from '../../working-memory/ReplacementSourceTagger';

function makeMessage(
  id: string,
  role: AiMessage['role'],
  type: AiMessage['type'],
): AiMessage {
  return AiMessage.parse({
    id,
    role,
    type,
    content: 'content',
    timestamp: Date.now(),
    metadata: {},
  });
}

function makeState(message: AiMessage, index: number): MessageProcessingState {
  return {
    message,
    originalIndex: index,
    action: 'skip',
    tokens: 100,
  };
}

describe('ReplacementSourceTagger', () => {
  it('adds replacement source ids with deduplication', () => {
    const tagger = new ReplacementSourceTagger();
    const state = makeState(makeMessage('m1', 'assistant', 'final_answer'), 0);

    tagger.addReplacementSources(state, ['id1', 'id2']);
    tagger.addReplacementSources(state, ['id1', 'id3']);

    expect(state.replacementSourceIds).toEqual(['id1', 'id2', 'id3']);
  });

  it('finds adjacent states in both directions and returns null when missing', () => {
    const tagger = new ReplacementSourceTagger();
    const states = [
      makeState(makeMessage('m1', 'user', 'user_input'), 0),
      makeState(makeMessage('m2', 'assistant', 'tool_calls'), 1),
      makeState(makeMessage('m3', 'tool', 'tool_output'), 2),
      makeState(makeMessage('m4', 'assistant', 'final_answer'), 3),
    ];
    const stateMap = new Map(states.map((state) => [state.originalIndex, state]));

    const forward = tagger.findAdjacentState(
      stateMap,
      2,
      1,
      (state) => state.message.type === 'final_answer',
    );
    const backward = tagger.findAdjacentState(
      stateMap,
      2,
      -1,
      (state) => state.message.type === 'user_input',
    );
    const missing = tagger.findAdjacentState(
      stateMap,
      0,
      -1,
      (state) => state.message.type === 'history_summary',
    );

    expect(forward?.message.id).toBe('m4');
    expect(backward?.message.id).toBe('m1');
    expect(missing).toBeNull();
  });

  it('tags only the pair members and does not spread to adjacent messages', () => {
    const tagger = new ReplacementSourceTagger();
    const states = [
      makeState(makeMessage('user1', 'user', 'user_input'), 0),
      makeState(makeMessage('tc1', 'assistant', 'tool_calls'), 1),
      makeState(makeMessage('to1', 'tool', 'tool_output'), 2),
      makeState(makeMessage('fa1', 'assistant', 'final_answer'), 3),
    ];

    tagger.tagReplacementSources([states[1], states[2]], states);

    expect(states[1].replacementSourceIds).toEqual(['tc1', 'to1']);
    expect(states[2].replacementSourceIds).toEqual(['tc1', 'to1']);
    expect(states[0].replacementSourceIds).toBeUndefined();
    expect(states[3].replacementSourceIds).toBeUndefined();
  });

  it('does nothing for an empty pair', () => {
    const tagger = new ReplacementSourceTagger();
    const state = makeState(makeMessage('m1', 'user', 'user_input'), 0);

    tagger.tagReplacementSources([], [state]);

    expect(state.replacementSourceIds).toBeUndefined();
  });
});
