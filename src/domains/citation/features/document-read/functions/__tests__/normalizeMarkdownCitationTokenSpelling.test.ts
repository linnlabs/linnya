import { describe, expect, it } from 'vitest';
import { normalizeMarkdownCitationTokenSpelling } from '../normalizeMarkdownCitationTokenSpelling';

describe('normalizeMarkdownCitationTokenSpelling', () => {
  it('只规范化正文 Citation token，不改写代码示例或普通文本', () => {
    expect(normalizeMarkdownCitationTokenSpelling([
      '正文 \\[@ABC234\\] 与 [@ABC235; @ABC236]',
      '',
      '`[@ABC237]`',
      '',
      '普通 [1]',
    ].join('\n'))).toBe([
      '正文 [@ABC234] 与 [@ABC235][@ABC236]',
      '',
      '`[@ABC237]`',
      '',
      '普通 [1]',
    ].join('\n'));
  });
});
