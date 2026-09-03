import { describe, expect, it } from 'vitest';

import { SlideMarkerIndex } from './slideMarkerIndex';

/**
 * Doc 27 P5 — slide 分页彻底回归 JS 语义。
 *
 * 设计宪法：
 *   - 一个 deck 有几页，由源码里**模块作用域**调用 `createSlide()` 的次数决定。
 *   - 不再支持 `// === SLIDE N ===` / `// === END SLIDE N ===` in-comment marker DSL。
 *     这些注释如果出现在 cookbook 历史模板里，解析器会把它们**当成普通注释忽略**——
 *     不会影响 slide 边界，也不会抛错。
 *   - `getSlideRange(N).startLine` = 第 N 个 `createSlide()` 调用所在行；
 *     `endLine` = 下一个 `createSlide()` 调用所在行 - 1，最后一页 endLine = 文件末尾。
 *
 * 这套约定让 AI 不需要学任何寄生在注释里的伪语法，
 * `createSlide()` / `compose({ slides })` 这些 JS 调用本身就是分页声明。
 */

describe('SlideMarkerIndex (AST-only分页)', () => {
  it('linear createSlide() calls map 1:1 to slides with end line inferred from next call / EOF', () => {
    const source = [
      'const accent = "#fff";',
      'const slide1 = createSlide();',
      'slide1.add(createText("One"));',
      '',
      'const slide2 = createSlide();',
      'slide2.add(createText("Two"));',
      'compose({ title: "Deck", slides: [slide1, slide2] });',
    ].join('\n');

    const index = SlideMarkerIndex.build(source);

    expect(index.listSlides()).toEqual([
      {
        slideNumber: 1,
        startLine: 2,
        endLine: 4,
        contentStartLine: 2,
        contentEndLine: 4,
      },
      {
        slideNumber: 2,
        startLine: 5,
        endLine: 7,
        contentStartLine: 5,
        contentEndLine: 7,
      },
    ]);
    expect(index.getSlideRange(2)).toEqual({
      slideNumber: 2,
      startLine: 5,
      endLine: 7,
      contentStartLine: 5,
      contentEndLine: 7,
    });
    expect(index.sliceSlide(2)).toBe([
      'const slide2 = createSlide();',
      'slide2.add(createText("Two"));',
      'compose({ title: "Deck", slides: [slide1, slide2] });',
    ].join('\n'));
  });

  it('returns an empty slide list when no createSlide() call appears in the source', () => {
    const source = [
      'const accent = "#fff";',
      '// just preamble, no slides yet',
    ].join('\n');

    const index = SlideMarkerIndex.build(source);
    expect(index.listSlides()).toEqual([]);
    expect(index.getSlideRange(1)).toBeNull();
  });

  it('只把直接 createSlide() 调用识别为分页，不匹配字符串、注释或成员方法', () => {
    const source = [
      'const label = "createSlide()";',
      '// createSlide();',
      'factory.createSlide();',
      'const slide = createSlide();',
    ].join('\n');

    expect(SlideMarkerIndex.build(source).listSlides()).toEqual([{
      slideNumber: 1,
      startLine: 4,
      endLine: 4,
      contentStartLine: 4,
      contentEndLine: 4,
    }]);
  });

  it('treats legacy `// === SLIDE N ===` and `// === END SLIDE N ===` comments as inert text', () => {
    const source = [
      '// === SLIDE 1: legacy cover ===',
      'const slide1 = createSlide();',
      'slide1.add(createText("One"));',
      '// === END SLIDE 1 ===',
      '// === SLIDE 2: legacy detail ===',
      'const slide2 = createSlide();',
      'slide2.add(createText("Two"));',
      '// === END SLIDE 2 ===',
      'compose({ title: "Deck", slides: [slide1, slide2] });',
    ].join('\n');

    const index = SlideMarkerIndex.build(source);

    expect(index.listSlides()).toEqual([
      {
        slideNumber: 1,
        startLine: 2,
        endLine: 5,
        contentStartLine: 2,
        contentEndLine: 5,
      },
      {
        slideNumber: 2,
        startLine: 6,
        endLine: 9,
        contentStartLine: 6,
        contentEndLine: 9,
      },
    ]);
  });

  it('never throws marker-shape errors regardless of comment marker validity', () => {
    const sources = [
      [
        '// === SLIDE 1: broken ===',
        'const slide = createSlide();',
        '// === END SLIDE 2 ===',
      ].join('\n'),
      [
        '// === SLIDE 1 ===',
        'const slide = createSlide();',
      ].join('\n'),
      [
        '// === SLIDE 1 ===',
        'const slide1 = createSlide();',
        '// === SLIDE 1 ===',
        'const slide2 = createSlide();',
      ].join('\n'),
    ];

    for (const source of sources) {
      expect(() => SlideMarkerIndex.build(source)).not.toThrow();
    }
  });

  it('normalizes CRLF line endings before computing line numbers', () => {
    const source = [
      'const slide = createSlide();',
      'slide.add(createText("crlf"));',
    ].join('\r\n');

    const index = SlideMarkerIndex.build(source);

    expect(index.getSlideRange(1)).toEqual({
      slideNumber: 1,
      startLine: 1,
      endLine: 2,
      contentStartLine: 1,
      contentEndLine: 2,
    });
  });

  it('validates 1-based line ranges in sliceRange and rejects invalid input', () => {
    const index = SlideMarkerIndex.build([
      'const slide = createSlide();',
      'slide.add(createText("ok"));',
    ].join('\n'));

    expect(() => index.sliceRange(0, 1)).toThrow('line_range_invalid');
    expect(() => index.sliceRange(3, 2)).toThrow('line_range_invalid');
    expect(() => index.sliceRange(1, 99)).toThrow('line_range_invalid');
  });

  it('throws line_range_invalid via sliceSlide(N) when slide N does not exist', () => {
    const index = SlideMarkerIndex.build('const slide = createSlide();');
    expect(() => index.sliceSlide(2)).toThrow('line_range_invalid');
  });
});
