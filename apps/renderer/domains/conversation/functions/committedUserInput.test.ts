import { describe, expect, it } from 'vitest';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import { mapCommittedUserInputToMessage } from './committedUserInput';

describe('mapCommittedUserInputToMessage', () => {
  it('只投影 durable attachment，并优先展示 raw_content', () => {
    const event: ConversationUserInputCommittedEvent = {
      id: 'message-1',
      type: 'user_input_committed',
      timestamp: 100,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      operation: 'append',
      content: '[context]\nquestion',
      raw_content: 'question',
      attachments: [{
        id: 'attachment-1',
        kind: 'image',
        assetId: 'asset-1',
        mediaType: 'image/png',
        byteLength: 4,
        width: 2,
        height: 2,
        sha256: 'a'.repeat(64),
      }],
    };

    expect(mapCommittedUserInputToMessage(event)).toMatchObject({
      id: 'message-1',
      content: 'question',
      attachments: [{ assetId: 'asset-1' }],
    });
  });
});
