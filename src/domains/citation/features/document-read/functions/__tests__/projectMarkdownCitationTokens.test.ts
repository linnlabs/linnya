import { describe, expect, it } from 'vitest';
import { projectMarkdownCitationTokens } from '../projectMarkdownCitationTokens';

describe('projectMarkdownCitationTokens', () => {
  it('规范化聚合/转义 token，同时保持其他 Markdown 和 code 示例原样', () => {
    const result = projectMarkdownCitationTokens({
      markdown: '**正文** \\[@ABC234; @ABC235\\]\n\n`[@ABC236]`',
      resolveRef: ref => `<${ref}>`,
    });

    expect(result).toBe('**正文** <ABC234><ABC235>\n\n`[@ABC236]`');
  });
});
