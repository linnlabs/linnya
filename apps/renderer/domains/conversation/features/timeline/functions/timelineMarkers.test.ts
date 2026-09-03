import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';
import {
  mergeTimelineMarkersWithVisibleMessages,
  projectTimelineMarkersFromMessages,
  projectTimelineMarkersFromTurnIndex,
} from './timelineMarkers';
import { readTimelineTurnIndexDto } from './timelineTurnIndexDtoGuard';

function userMessage(id: string, content: string): BaseMessage {
  return createTestUserMessage({ id, content, timestamp: 0 });
}

describe('timeline markers', () => {
  it('keeps the full persisted index while visible messages override and append live turns', () => {
    const indexed = projectTimelineMarkersFromTurnIndex([
      { visual_turn_id: conversationVisualTurnIdFromUserMessageId('u1'), ordinal: 1, summary: 'first', anchor_message_id: 'u1', sort_seq: 1 },
      { visual_turn_id: conversationVisualTurnIdFromUserMessageId('u2'), ordinal: 2, summary: 'second', anchor_message_id: 'u2', sort_seq: 10 },
      { visual_turn_id: conversationVisualTurnIdFromUserMessageId('u3'), ordinal: 3, summary: 'third', anchor_message_id: 'u3', sort_seq: 20 },
    ]);

    const markers = mergeTimelineMarkersWithVisibleMessages(indexed, [
      userMessage('u3', 'edited third'),
      userMessage('u4', 'live fourth'),
    ]);

    expect(markers.map(marker => [marker.visualTurnId, marker.summary])).toEqual([
      ['visual_turn_u1', 'first'],
      ['visual_turn_u2', 'second'],
      ['visual_turn_u3', 'edited third'],
      ['visual_turn_u4', 'live fourth'],
    ]);
    expect(markers[3]?.anchorMessageId).toBe('u4');
    expect(markers.map(marker => marker.turnIndex)).toEqual([0, 1, 2, 3]);
  });

  it('builds a deterministic fallback from visible user turns', () => {
    const markers = projectTimelineMarkersFromMessages([
      userMessage('u1', '  first\nquestion  '),
      createTestAnswerMessage({ id: 'a1', content: 'answer', timestamp: 1 }),
      userMessage('u2', 'second'),
    ]);

    expect(markers.map(marker => [marker.visualTurnId, marker.summary, marker.turnIndex])).toEqual([
      ['visual_turn_u1', 'first question', 0],
      ['visual_turn_u2', 'second', 1],
    ]);
  });

  it('rejects Runtime-style and partial identities at the timeline wire boundary', () => {
    const response = (turn: Record<string, unknown>) => ({
      success: true,
      conversation_id: 'conversation-1',
      revision: 1,
      turns: [{
        ordinal: 1,
        summary: 'question',
        anchor_message_id: 'u1',
        sort_seq: 1,
        ...turn,
      }],
    });

    expect(() => readTimelineTurnIndexDto(response({ turn_id: 'runtime-turn-1' }))).toThrow(
      'timeline DTO contract',
    );
    expect(() => readTimelineTurnIndexDto(response({
      visual_turn_id: 'visual_turn_partial_answer-1',
    }))).toThrow('timeline DTO contract');
  });
});
