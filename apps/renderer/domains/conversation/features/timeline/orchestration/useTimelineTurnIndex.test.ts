import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageWindowStatus } from '../../../message-window';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type {
  TimelineTurnIndexApiPort,
  TimelineTurnIndexDto,
} from '../definitions/timelineTurnIndex';
import { useTimelineTurnIndex } from './useTimelineTurnIndex';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';

function userMessage(id: string, content = id): BaseMessage {
  return createTestUserMessage({ id, content, timestamp: 0 });
}

function messageRef(messages: BaseMessage[]) {
  return shallowRef(messages);
}

function readyDto(ids: readonly string[], revision: number): TimelineTurnIndexDto {
  return {
    success: true,
    conversation_id: 'conversation-1',
    revision,
    turns: ids.map((id, ordinal) => ({
      visual_turn_id: conversationVisualTurnIdFromUserMessageId(id),
      ordinal,
      summary: id,
      anchor_message_id: id,
      sort_seq: ordinal * 10,
    })),
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useTimelineTurnIndex', () => {
  it('loads the full index once and appends a live user turn without refetching', async () => {
    const readTurnIndex = vi.fn(async () => readyDto(['u1', 'u2', 'u3'], 1));
    const api: TimelineTurnIndexApiPort = { readTurnIndex };
    const messages = messageRef([userMessage('u3')]);
    const scope = effectScope();
    const result = scope.run(() => useTimelineTurnIndex({
      conversationId: ref('conversation-1'),
      messages,
      isStreaming: ref(false),
      windowConversationId: ref('conversation-1'),
      windowStatus: ref<MessageWindowStatus>('ready'),
      windowRevision: ref(1),
    }, { api }));

    await flushAsyncWork();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual([
      'visual_turn_u1', 'visual_turn_u2', 'visual_turn_u3',
    ]);

    const settledMarkers = result?.markers.value;
    messages.value = [
      ...messages.value,
      createTestAnswerMessage({ id: 'a3', content: 'stream chunk', timestamp: 1 }),
    ];
    await nextTick();
    expect(result?.markers.value).toBe(settledMarkers);

    messages.value = [...messages.value, userMessage('u4')];
    await nextTick();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual([
      'visual_turn_u1', 'visual_turn_u2', 'visual_turn_u3', 'visual_turn_u4',
    ]);
    expect(readTurnIndex).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('keeps the visible fallback while preparing and retries the index', async () => {
    vi.useFakeTimers();
    const readTurnIndex = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        status: 'preparing',
        conversation_id: 'conversation-1',
      } satisfies TimelineTurnIndexDto)
      .mockResolvedValueOnce(readyDto(['u1', 'u2'], 1));
    const scope = effectScope();
    const result = scope.run(() => useTimelineTurnIndex({
      conversationId: ref('conversation-1'),
      messages: messageRef([userMessage('u2')]),
      isStreaming: ref(false),
      windowConversationId: ref('conversation-1'),
      windowStatus: ref<MessageWindowStatus>('ready'),
      windowRevision: ref(1),
    }, { api: { readTurnIndex } }));

    await flushAsyncWork();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual(['visual_turn_u2']);

    await vi.advanceTimersByTimeAsync(500);
    await flushAsyncWork();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual(['visual_turn_u1', 'visual_turn_u2']);
    expect(readTurnIndex).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('reloads the authoritative index when revision changes and when streaming settles', async () => {
    const readTurnIndex = vi.fn()
      .mockResolvedValueOnce(readyDto(['u1', 'u2', 'u3'], 1))
      .mockResolvedValueOnce(readyDto(['u1', 'u2'], 2))
      .mockResolvedValueOnce(readyDto(['u1'], 3));
    const windowRevision = ref(1);
    const isStreaming = ref(true);
    const scope = effectScope();
    const result = scope.run(() => useTimelineTurnIndex({
      conversationId: ref('conversation-1'),
      messages: messageRef([userMessage('u1')]),
      isStreaming,
      windowConversationId: ref('conversation-1'),
      windowStatus: ref<MessageWindowStatus>('ready'),
      windowRevision,
    }, { api: { readTurnIndex } }));

    await flushAsyncWork();
    windowRevision.value = 2;
    await flushAsyncWork();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual(['visual_turn_u1', 'visual_turn_u2']);

    isStreaming.value = false;
    await flushAsyncWork();
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual(['visual_turn_u1']);
    expect(readTurnIndex).toHaveBeenCalledTimes(3);
    scope.stop();
  });

  it('exposes index failures instead of presenting window markers as a complete timeline', async () => {
    const readTurnIndex = vi.fn()
      .mockRejectedValueOnce(new Error('turn index unavailable'))
      .mockResolvedValueOnce(readyDto(['u1', 'u2'], 2));
    const scope = effectScope();
    const result = scope.run(() => useTimelineTurnIndex({
      conversationId: ref('conversation-1'),
      messages: messageRef([userMessage('u2')]),
      isStreaming: ref(false),
      windowConversationId: ref('conversation-1'),
      windowStatus: ref<MessageWindowStatus>('ready'),
      windowRevision: ref(1),
    }, { api: { readTurnIndex } }));

    await flushAsyncWork();
    expect(result?.status.value).toBe('error');
    expect(result?.markers.value).toEqual([]);

    await result?.refresh('conversation-1');
    expect(result?.status.value).toBe('ready');
    expect(result?.markers.value.map(marker => marker.visualTurnId)).toEqual(['visual_turn_u1', 'visual_turn_u2']);
    scope.stop();
  });
});
