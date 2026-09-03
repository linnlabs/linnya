import { describe, expect, it } from 'vitest';

import {
  RuntimeResourceRef,
  createToolOutputEvent,
  createUserInputEvent,
  validateAiMessage,
  validateRuntimeEvent,
} from '../index';

const imageRef = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'resource-1',
  mediaType: 'image/png' as const,
  byteLength: 1024,
  width: 640,
  height: 480,
  sha256: 'a'.repeat(64),
  fileName: 'diagram.png',
  label: 'diagram',
};

describe('RuntimeResourceRef durable contract', () => {
  it('accepts provider-neutral image facts and rejects host/provider identities', () => {
    expect(RuntimeResourceRef.parse(imageRef)).toEqual(imageRef);
    expect(RuntimeResourceRef.safeParse({ ...imageRef, assetId: 'asset-1' }).success).toBe(false);
    expect(RuntimeResourceRef.safeParse({ ...imageRef, localPath: '/tmp/image.png' }).success).toBe(false);
    expect(RuntimeResourceRef.safeParse({ ...imageRef, providerFileId: 'file-1' }).success).toBe(false);
  });

  it('allows ordered attachments on user_input and tool_output messages', () => {
    const user = validateAiMessage({
      id: 'user-1',
      role: 'user',
      type: 'user_input',
      content: '',
      timestamp: 1,
      attachments: [imageRef, { ...imageRef, id: 'attachment-2', resourceId: 'resource-2' }],
    });
    const tool = validateAiMessage({
      id: 'tool-1',
      role: 'tool',
      type: 'tool_output',
      content: 'rendered',
      timestamp: 1,
      attachments: [imageRef],
    });

    expect(user.success).toBe(true);
    expect(tool.success).toBe(true);
    if (!user.success) throw new Error(user.error.message);
    if (user.data.role !== 'user' || user.data.type !== 'user_input') {
      throw new Error('expected user_input message');
    }
    expect(user.data.attachments?.map(attachment => attachment.id)).toEqual([
      'attachment-1',
      'attachment-2',
    ]);
  });

  it('rejects attachments on non-model-resource message placements', () => {
    for (const message of [
      { id: 'system-1', role: 'system', type: 'system_prompt', content: 'system', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', type: 'final_answer', content: 'answer', timestamp: 1 },
      { id: 'context-1', role: 'user', type: 'context_injection', content: 'context', timestamp: 1 },
    ]) {
      expect(validateAiMessage({ ...message, attachments: [imageRef] }).success).toBe(false);
    }
  });

  it('preserves attachments in user_input and tool_output event contracts', () => {
    const user = createUserInputEvent('user-1', 'conversation-1', 'turn-1', '', {
      attachments: [imageRef],
    });
    const tool = createToolOutputEvent(
      'tool-1',
      'conversation-1',
      'turn-1',
      'render',
      'call-1',
      { status: 'success', observation: 'rendered', data: { path: 'image.png' } },
      { attachments: [imageRef] },
    );

    expect(validateRuntimeEvent(user).success).toBe(true);
    expect(validateRuntimeEvent(tool).success).toBe(true);
    expect(user.attachments).toEqual([imageRef]);
    expect(tool.attachments).toEqual([imageRef]);
  });

  it('rejects attachments on unrelated runtime events', () => {
    expect(validateRuntimeEvent({
      id: 'answer-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      type: 'final_answer',
      answer_id: 'answer-id-1',
      content: 'answer',
      attachments: [imageRef],
    }).success).toBe(false);
  });
});
