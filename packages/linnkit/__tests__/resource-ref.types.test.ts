import { describe, expect, it } from 'vitest';

import type { RuntimeResourceRef } from '../src/contracts';
import type { LlmRequestMessage } from '../src/ports';

const imageRef: RuntimeResourceRef = {
  id: 'attachment-1',
  kind: 'image',
  resourceId: 'resource-1',
  mediaType: 'image/png',
  byteLength: 1024,
  width: 640,
  height: 480,
  sha256: 'a'.repeat(64),
};

const userMessage: LlmRequestMessage = {
  role: 'user',
  content: '',
  attachments: [imageRef],
};

const toolMessage: LlmRequestMessage = {
  role: 'tool',
  tool_call_id: 'call-1',
  content: 'rendered',
  attachments: [imageRef],
};

const invalidSystemMessage: LlmRequestMessage = {
  role: 'system',
  content: 'system',
  // @ts-expect-error system 消息不能携带模型资源附件。
  attachments: [imageRef],
};

const invalidAssistantMessage: LlmRequestMessage = {
  role: 'assistant',
  content: 'answer',
  // @ts-expect-error assistant 消息不能携带模型资源附件。
  attachments: [imageRef],
};

describe('LlmRequestMessage resource placement types', () => {
  it('only exposes attachments on user and tool request messages', () => {
    expect(userMessage.role).toBe('user');
    expect(toolMessage.role).toBe('tool');
    expect(invalidSystemMessage.role).toBe('system');
    expect(invalidAssistantMessage.role).toBe('assistant');
  });
});
