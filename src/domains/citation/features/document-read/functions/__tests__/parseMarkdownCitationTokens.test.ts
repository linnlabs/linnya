import { describe, expect, it } from 'vitest';
import {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  parseMarkdownCitationTokens,
} from '../parseMarkdownCitationTokens';
import { projectMarkdownCitationTokens } from '../projectMarkdownCitationTokens';

describe('Markdown citation token protocol', () => {
  it('段落行首引用经 serializer 写成实体左括号后仍是引用', () => {
    expect(
      parseMarkdownCitationTokens('&#91;@ABC234\\] 后文 [@ABC235]').map(token => ({
        raw: token.raw,
        refs: token.refs,
      }))
    ).toEqual([
      { raw: '&#91;@ABC234\\]', refs: ['ABC234'] },
      { raw: '[@ABC235]', refs: ['ABC235'] },
    ]);
    expect(
      projectMarkdownCitationTokens({
        markdown: '&#91;@ABC234\\] 后文',
        resolveRef: ref => `[@${ref === 'ABC234' ? 'XYZ234' : ref}]`,
      })
    ).toBe('[@XYZ234] 后文');
  });

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

  it('不把跨空段的反引号当成行内代码，同时保留跨软换行的代码语义', () => {
    expect(extractCanonicalCitationRefs('`[@ABC234]\n\n其他 `text`')).toEqual(['ABC234']);
    expect(extractCanonicalCitationRefs('`[@ABC234]\r\n \t\r\n其他 `text`')).toEqual(['ABC234']);
    expect(findInvalidMarkdownCitationTokens('`[@bad]\n\n其他 `text`')).toEqual(['[@bad]']);
    expect(extractCanonicalCitationRefs('`代码\n[@ABC234]` 正文 [@ABC235]')).toEqual(['ABC235']);
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

  it('代码内反斜杠不转义闭合反引号，后续正文引用仍被校验', () => {
    expect(extractCanonicalCitationRefs('`x\\` [@Abc234] `y`')).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens('`x\\` [@bad] `y`')).toEqual(['[@bad]']);
    expect(extractCanonicalCitationRefs('``x\\`` [@Abc234] ``y``')).toEqual(['Abc234']);
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


describe('HTML comment 与 code 的词法保护', () => {
  it('注释内合法和非法 token 都不是来源，未闭合注释保护到 EOF', () => {
    const text = '正文 [@Abc234] <!-- 隐藏 [@Def567] [@bad] --> 后文 [@GhJ678]';
    expect(extractCanonicalCitationRefs(text)).toEqual(['Abc234', 'GhJ678']);
    expect(findInvalidMarkdownCitationTokens(text)).toEqual([]);
    expect(extractCanonicalCitationRefs('正文 [@Abc234] <!-- [@Def567]')).toEqual(['Abc234']);
  });

  it('注释中的反引号不与注释外的反引号配对，不吞正文引用', () => {
    const text = '<!-- ` [@Def567] --> 正文 [@Abc234] `tail';
    expect(extractCanonicalCitationRefs(text)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens('<!-- ` [@bad] --> 正文 [@oops] `tail'))
      .toEqual(['[@oops]']);
  });

  it('code span 内的注释 opener 不延伸到后面的正文', () => {
    expect(extractCanonicalCitationRefs('`<!-- [@Def567]` 正文 [@Abc234]'))
      .toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens('`<!-- [@bad]` 正文 [@oops]'))
      .toEqual(['[@oops]']);
  });

  it('fence 内注释不生效，注释内 fence 也不生效', () => {
    const codeFirst = ['```md', '<!-- [@Def567]', '```', '正文 [@Abc234]'].join('\n');
    const commentFirst = ['<!--', '```', '[@Def567]', '-->', '正文 [@Abc234]'].join('\n');
    expect(extractCanonicalCitationRefs(codeFirst)).toEqual(['Abc234']);
    expect(extractCanonicalCitationRefs(commentFirst)).toEqual(['Abc234']);
  });
});


describe('链接 destination/title 不参与引用接纳或别名回投', () => {
  const protectedLinks = [
    '[文章](https://example.com/[@Abc234] "标题 [@bad]")',
    "![图片](<https://example.com/a([@Abc234])> '标题 [@bad]')",
    '[文章](https://example.com/a([@Abc234]) (标题 [@bad]))',
    '<https://example.com/[@Abc234]>',
    String.raw`[文章](https://example.com/\([@Abc234]\) "引号\" [@bad]")`,
    '[source]: https://example.com/[@Abc234] "标题 [@bad]"',
    '[source]:\n <https://example.com/[@Abc234]>\n "标题 [@bad]"',
    "[source]: https://example.com/[@Abc234]\n '多行\n标题 [@bad]'",
  ];

  it.each(protectedLinks)('只改可见正文，不改目的地址和title：%s', link => {
    const markdown = `${link}\n\n正文 [@Abc234]`;
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(parseMarkdownCitationTokens(markdown)).toHaveLength(1);
    expect(findInvalidMarkdownCitationTokens(markdown)).toEqual([]);
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@Def567]' }))
      .toBe(`${link}\n\n正文 [@Def567]`);
  });

  it('可见link label内真正的引用仍然生效，目的区的同名token不变', () => {
    const markdown = '[见 [@Abc234]](https://example.com/[@Abc234] "[@bad]")';
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens(markdown)).toEqual([]);
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@Def567]' }))
      .toBe('[见 [@Def567]](https://example.com/[@Abc234] "[@bad]")');
  });

  it.each([
    '(普通括号 [@Abc234])',
    '\\[label](https://example.com/[@Abc234])',
    '[label] (https://example.com/[@Abc234])',
    '没有label]([@Abc234])',
    '[label](https://example.com/[@Abc234]',
    '[label](https://example.com/[@Abc234] "未闭合title)',
    '[broken\n\n](https://example.com/[@Abc234])',
  ])('未构成链接的字面正文仍校验与回投：%s', markdown => {
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@Def567]' }))
      .toBe(markdown.replace('[@Abc234]', '[@Def567]'));
    expect(findInvalidMarkdownCitationTokens(markdown.replace('[@Abc234]', '[@bad]')))
      .toEqual(['[@bad]']);
  });

  it('目的区先进入的反引号或comment不是词法指令，不吞后续正文', () => {
    const link = '[文章](https://example.com/` "<!-- [@bad]")';
    const markdown = `${link} 正文 [@Abc234] \`tail\``;
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens(markdown)).toEqual([]);
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@Def567]' }))
      .toBe(`${link} 正文 [@Def567] \`tail\``);
  });

  it('code/comment先进入时仍保护其中的link，label内code中的假闭合不结束链接', () => {
    const markdown = [
      '`[例](https://example.com/[@Def567])`',
      '<!-- [例](https://example.com/[@bad]) -->',
      '[见 `](假链接<!--` [@Abc234]](https://example.com/[@Def567])',
    ].join('\n\n');
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens(markdown)).toEqual([]);
  });

  it('内层link使外层不再是链接，但image可位于真正的link label中', () => {
    expect(extractCanonicalCitationRefs(
      '[outer [inner](https://example.com/[@Def567])](literal/[@Abc234])',
    )).toEqual(['Abc234']);
    expect(extractCanonicalCitationRefs(
      '[![image](https://example.com/[@Def567]) [@Abc234]](https://example.com/[@Def567])',
    )).toEqual(['Abc234']);
  });

  it('reference定义后的普通段落与无效title仍保留正文引用语义', () => {
    const markdown = '[source]: https://example.com/[@Def567]\n正文 [@Abc234]';
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens(
      '[source]: https://example.com/[@Def567]\n "未闭合title [@bad]',
    )).toEqual(['[@bad]']);
  });
});


describe('词法保护区不与正文跨界配对 Citation token', () => {
  it.each([
    '[链接](https://example.com/[@) 正文 [@Abc234]',
    '[链接](https://example.com/ "半截 [@") 正文 [@Abc234]',
    '<https://example.com/[@> 正文 [@Abc234]',
    '[source]: https://example.com/[@\n\n正文 [@Abc234]',
    '`半截 [@` 正文 [@Abc234]',
    '<!-- 半截 [@ --> 正文 [@Abc234]',
  ])('保护区内半截不吞后续正文：%s', markdown => {
    expect(extractCanonicalCitationRefs(markdown)).toEqual(['Abc234']);
    expect(findInvalidMarkdownCitationTokens(markdown.replace('[@Abc234]', '[@bad]')))
      .toEqual(['[@bad]']);
    expect(projectMarkdownCitationTokens({ markdown, resolveRef: () => '[@Def567]' }))
      .toBe(markdown.replace('[@Abc234]', '[@Def567]'));
  });
});
