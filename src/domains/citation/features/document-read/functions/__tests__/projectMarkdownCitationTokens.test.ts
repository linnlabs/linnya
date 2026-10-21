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

  it('安全回投只改正文引用，HTML comment 与代码中的同名 token 保持逐字不变', () => {
    const markdown = '<!-- ` [@ABC234] --> 正文 [@ABC234] `<!-- [@ABC234]`';
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@DEF567]' }))
      .toBe('<!-- ` [@ABC234] --> 正文 [@DEF567] `<!-- [@ABC234]`');
  });
});
