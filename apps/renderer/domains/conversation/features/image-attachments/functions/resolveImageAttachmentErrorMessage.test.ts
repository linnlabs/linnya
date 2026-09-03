import { describe, expect, it } from 'vitest';
import { ConversationImageAttachmentErrorCodeSchema } from '@app/schemas';
import { resolveImageAttachmentErrorMessage } from './resolveImageAttachmentErrorMessage';

describe('resolveImageAttachmentErrorMessage', () => {
  it('为所有稳定图片错误码提供本地化消息键', () => {
    for (const code of ConversationImageAttachmentErrorCodeSchema.options) {
      expect(resolveImageAttachmentErrorMessage(code)).toMatch(/^conversation\.error\.image/);
    }
  });
});
