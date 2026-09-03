import { nextTick, ref, shallowRef, watch } from 'vue';
import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { defaultEstimationRegistry } from '../utils/estimationRegistry';
import { useAppendOnlyConversationVisualRows } from './useAppendOnlyConversationVisualRows';

function message(id: string, type: BaseMessage['type'], content: string): BaseMessage {
  return type === 'user_input'
    ? createTestUserMessage({ id, content, timestamp: 1 })
    : createTestAnswerMessage({ id, content, timestamp: 1 });
}

function mountProjection(source: BaseMessage[], reset = 'conversation-a') {
  const messages = shallowRef(source);
  const resetKey = ref(reset);
  return {
    messages,
    resetKey,
    ...useAppendOnlyConversationVisualRows({
      messages,
      resetKey,
      widthPx: ref(680),
      estimationRegistry: defaultEstimationRegistry,
    }),
  };
}

describe('useAppendOnlyConversationVisualRows', () => {
  it('rebuilds cleanly when the active conversation changes', async () => {
    const fixture = mountProjection([
      message('u1', 'user_input', 'first'),
      message('a1', 'final_answer', 'answer'),
    ]);
    await nextTick();

    fixture.messages.value = [message('u2', 'user_input', 'next')];
    fixture.resetKey.value = 'conversation-b';
    await nextTick();

    expect(fixture.visualRows.value.map(row => row.key)).toEqual(['msg_u2']);
  });

  it('notifies Vue when a streaming tail changes inside the stable rows array', async () => {
    const answer = message('a1', 'final_answer', 'a');
    const fixture = mountProjection([message('u1', 'user_input', 'question'), answer]);
    await nextTick();
    let notifications = 0;
    const stop = watch(fixture.visualRows, () => { notifications += 1; }, { flush: 'sync' });
    const previousRows = fixture.visualRows.value;

    answer.content = 'answer extended';
    fixture.messages.value = fixture.messages.value.slice();
    await nextTick();

    expect(fixture.visualRows.value).toBe(previousRows);
    expect(fixture.visualRows.value[1]?.payload.content).toBe('answer extended');
    expect(notifications).toBe(1);
    stop();
  });
});
