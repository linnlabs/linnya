import { describe, expect, it } from 'vitest';
import { webToolConfigs } from './web';

describe('webToolConfigs', () => {
  it('web_search 由 presentation projector 唯一解释 payload 与标题', () => {
    expect(webToolConfigs['web_search']?.presentation).toBeTypeOf('function');
  });

  it('web_read 由 presentation projector 唯一解释 payload 与标题', () => {
    expect(webToolConfigs['web_read']?.presentation).toBeTypeOf('function');
  });
});
