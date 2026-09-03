import { describe, expect, it } from 'vitest';

import type { RuntimeResourceRef } from '../../../../../contracts';
import { ConversationSession } from '../ConversationSession';
import { ToolCallIdSchema } from '../../../../../contracts';

describe('ConversationSession.deserialize', () => {
  const attachments: RuntimeResourceRef[] = [
    {
      id: 'attachment-1',
      kind: 'image',
      resourceId: 'resource-1',
      mediaType: 'image/png',
      byteLength: 1024,
      width: 640,
      height: 480,
      sha256: 'a'.repeat(64),
    },
  ];

  it('restores the current snapshot shape without mutating timestamps', () => {
    const session = new ConversationSession('system prompt');
    session.addUserMessage('hello', 'user-1');

    const restored = ConversationSession.deserialize(session.serialize());

    expect(restored.getSystemPrompt()).toBe('system prompt');
    expect(restored.getHistory().map(message => message.id)).toContain('user-1');
    expect(restored.getHistory().every(message => typeof message.timestamp === 'number')).toBe(
      true
    );
  });

  it('rejects legacy history snapshots instead of silently coercing DTOs', () => {
    expect(() =>
      ConversationSession.deserialize(
        JSON.stringify({
          systemPrompt: 'system prompt',
          history: [],
        })
      )
    ).toThrow();
  });

  it('rejects messages with non-numeric timestamps', () => {
    expect(() =>
      ConversationSession.deserialize(
        JSON.stringify({
          systemPrompt: 'system prompt',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              type: 'user_input',
              content: 'hello',
              timestamp: new Date().toISOString(),
            },
          ],
        })
      )
    ).toThrow();
  });

  it('restores ordered user/tool attachments from a session snapshot', () => {
    const session = new ConversationSession('system prompt');
    session.addUserMessage('', 'user-1', attachments);
    session.addToolResponse(
      ToolCallIdSchema.parse('call-1'),
      'rendered',
      'render',
      'tool-1',
      attachments
    );

    const restored = ConversationSession.deserialize(session.serialize());
    const restoredAttachmentIds = restored.getHistory().flatMap(message => {
      if (message.role === 'user' && message.type === 'user_input') {
        return [message.attachments?.map(attachment => attachment.id)];
      }
      if (message.role === 'tool' && message.type === 'tool_output') {
        return [message.attachments?.map(attachment => attachment.id)];
      }
      return [];
    });

    expect(restoredAttachmentIds).toEqual([['attachment-1'], ['attachment-1']]);
  });
});
