import { describe, expect, it } from 'vitest';
import {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  parseMarkdownCitationTokens,
} from '../parseMarkdownCitationTokens';

describe('Markdown citation token protocol', () => {
  it('按正文顺序解析单条、聚合与模型转义写法', () => {
    const markdown = 'A [@ABC234] B [@ABC235; @ABC236] C \\[@ABC237\\]';

    expect(
      parseMarkdownCitationTokens(markdown).map(token => ({
        raw: token.raw,
        refs: token.refs,
      }))
    ).toEqual([
      { raw: '[@ABC234]', refs: ['ABC234'] },
      { raw: '[@ABC235; @ABC236]', refs: ['ABC235', 'ABC236'] },
      { raw: '\\[@ABC237\\]', refs: ['ABC237'] },
    ]);
    expect(extractCanonicalCitationRefs(markdown)).toEqual([
      'ABC234',
      'ABC235',
      'ABC236',
      'ABC237',
    ]);
  });

  it('严格拒绝正式 schema 之外的易混淆字符', () => {
    expect(extractCanonicalCitationRefs('[@ABC230] [@ABC23I] [@ABC23_] [@ABC234]')).toEqual([
      'ABC234',
    ]);
  });

  it('跳过 fenced code 与 inline code 中的引用示例', () => {
    const markdown = [
      '正文 [@ABC234]',
      '',
      '```markdown',
      '示例 [@ABC235]',
      '```',
      '',
      '行内 `[@ABC236]` 也不是引用。',
      '波浪围栏：',
      '~~~',
      '[@ABC237]',
      '~~~',
    ].join('\n');

    expect(extractCanonicalCitationRefs(markdown)).toEqual(['ABC234']);
  });

  it('未闭合 code fence 的剩余内容全部保持代码语义', () => {
    expect(extractCanonicalCitationRefs('正文 [@ABC234]\n```\n[@ABC235]')).toEqual(['ABC234']);
  });

  it('带 info string 的 fence 只能由纯 marker 行关闭，转义反引号不创建 code span', () => {
    const markdown = [
      '```md',
      '[@ABC234]',
      '```not-a-close',
      '[@ABC235]',
      '```',
      '\\`正文 [@ABC236]\\`',
    ].join('\n');

    expect(extractCanonicalCitationRefs(markdown)).toEqual(['ABC236']);
  });
});

describe('findInvalidMarkdownCitationTokens', () => {
  it('报告完整的非法与混合引用 token，但忽略代码示例', () => {
    const markdown = [
      '非法 [@ABC123]，混合 [@Abc234; @bad]。',
      '`[@ABC123]`',
      '```md',
      '[@bad]',
      '```',
    ].join('\n');

    expect(findInvalidMarkdownCitationTokens(markdown)).toEqual([
      '[@ABC123]',
      '[@Abc234; @bad]',
    ]);
  });

  it('接纳多个 canonical Base58 refs', () => {
    expect(findInvalidMarkdownCitationTokens('事实 [@Abc234; @Def567]。')).toEqual([]);
  });
});
