import assert from 'node:assert/strict';

import type { SerializableJsonValue } from '@linnlabs/linnkit/contracts';
import type {
  CanonicalInferenceEvent,
  CanonicalInferenceMessage,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';

export function startInferenceEvent(
  request: CanonicalInferenceRequest,
): CanonicalInferenceEvent {
  return {
    type: 'start',
    model_id: request.model_id,
    attempt_id: request.invocation.attempt_id,
  };
}

export function requireToolMessageText(
  messages: readonly CanonicalInferenceMessage[],
  toolCallId: string,
): string {
  const message = messages.find(candidate => (
    candidate.role === 'tool' && candidate.tool_call_id === toolCallId
  ));
  assert(message?.role === 'tool', `missing tool result: ${toolCallId}`);
  return message.content.map((block) => {
    assert.equal(block.type, 'text', `tool result ${toolCallId} must be text-only`);
    if (block.type !== 'text') throw new Error(`tool result ${toolCallId} must be text-only`);
    return block.text;
  }).join('');
}

export function toolCallEvents(input: {
  readonly index?: number;
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, SerializableJsonValue>>;
}): readonly CanonicalInferenceEvent[] {
  const index = input.index ?? 0;
  const argumentsRecord = { ...input.arguments };
  return [
    {
      type: 'tool_call_start',
      index,
      part_index: index,
      id: input.id,
      name: input.name,
    },
    {
      type: 'tool_argument_delta',
      index,
      json_delta: JSON.stringify(argumentsRecord),
    },
    {
      type: 'tool_call_end',
      index,
      call: {
        id: input.id,
        name: input.name,
        arguments: argumentsRecord,
      },
    },
    { type: 'finish', reason: 'tool_use' },
  ];
}

export function answerEvents(text: string): readonly CanonicalInferenceEvent[] {
  return [
    { type: 'answer_delta', text },
    {
      type: 'assistant_part_end',
      index: 0,
      part: { type: 'text', text },
    },
    { type: 'finish', reason: 'stop' },
  ];
}
