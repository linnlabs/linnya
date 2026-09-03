import { describe, expect, it } from 'vitest';

import { createUserMessage, validateAiMessage } from '../messages';
import type { RuntimeResourceRef } from '../resource-ref';

const attachments: readonly RuntimeResourceRef[] = [
  {
    id: 'attachment-first',
    kind: 'image',
    resourceId: 'asset-first',
    mediaType: 'image/png',
    byteLength: 128,
    width: 16,
    height: 8,
    sha256: 'a'.repeat(64),
    fileName: 'first.png',
  },
  {
    id: 'attachment-second',
    kind: 'image',
    resourceId: 'asset-second',
    mediaType: 'image/webp',
    byteLength: 256,
    width: 32,
    height: 24,
    sha256: 'b'.repeat(64),
    fileName: 'second.webp',
  },
];

describe('createUserMessage', () => {
  it('preserves durable attachment identity and order for user_input', () => {
    const message = createUserMessage('user_input', '', undefined, attachments);

    expect(message.attachments).toEqual(attachments);
    expect(message.attachments).not.toBe(attachments);
    expect(validateAiMessage(message).success).toBe(true);
  });

  it('keeps the existing text-only user_input contract', () => {
    expect(createUserMessage('user_input', 'hello')).toMatchObject({
      role: 'user',
      type: 'user_input',
      content: 'hello',
    });
  });
});
