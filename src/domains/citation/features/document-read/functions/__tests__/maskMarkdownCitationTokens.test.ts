import { describe, expect, it } from 'vitest';
import { maskMarkdownCitationTokens } from '../maskMarkdownCitationTokens';

describe('maskMarkdownCitationTokens', () => {
  it('旁路文本不暴露 canonical ref，并保留代码示例', () => {
    expect(maskMarkdownCitationTokens(
      '新增 \\[@ABC234\\] 和 [@ABC235; @ABC236]，示例 `[@ABC237]`',
    )).toBe(
      '新增 【citation】 和 【citation】【citation】，示例 `[@ABC237]`',
    );
  });
});
