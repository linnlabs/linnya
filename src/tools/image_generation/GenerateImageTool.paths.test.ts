import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toConversationImageLocator } from './GenerateImageTool';

describe('generate_image conversation locators', () => {
  it('returns a canonical conversation locator for an admitted workspace file', () => {
    expect(toConversationImageLocator('/work/conversation', '/work/conversation/generated-images/image.png'))
      .toBe('conversation:/generated-images/image.png');
  });

  it('rejects a generated file outside the admitted conversation workspace', () => {
    expect(() => toConversationImageLocator('/work/conversation', path.resolve('/work/other/image.png')))
      .toThrow('escaped the conversation workspace');
  });
});
