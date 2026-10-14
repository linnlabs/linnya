import { describe, expect, it } from 'vitest';
import { SlideMarkerIndex } from '@plugin/slides/shared';
import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck/typecheckCodegenSource';
import {
  insertBlankSlideIntoDeckSource,
  SlidesSlideInsertionSourceError,
} from './insertBlankSlideIntoDeckSource';
import { resolveInsertedSlideBackgroundColor } from './resolveInsertedSlideBackgroundColor';

const TWO_SLIDE_SOURCE = `const navy = "#12233F";

const coverSlide = createSlide({ slideKey: "cover" });
coverSlide.add(createText("Cover")); // cover title

// ── Closing ──
const closingSlide = createSlide({ slideKey: "closing" });
closingSlide.add(createText("Thanks"));

compose({
  title: "Demo",
  slides: [coverSlide, closingSlide],
});
`;

function insert(source: string, index: number, slideCount = 2) {
  return insertBlankSlideIntoDeckSource(source, { index, slideCount, backgroundColor: '#0B0B0F' });
}

function readCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof SlidesSlideInsertionSourceError) return error.code;
    throw error;
  }
  return undefined;
}

describe('insertBlankSlideIntoDeckSource', () => {
  it('在当前页之后插入顶层声明，保留下一页的前置注释和上一页行尾注释', () => {
    const result = insert(TWO_SLIDE_SOURCE, 1);

    expect(result).toMatchObject({ variableName: 'blankSlide1', slideKey: 'blank-slide-1' });
    expect(result.source).toBe(TWO_SLIDE_SOURCE
      .replace(
        'coverSlide.add(createText("Cover")); // cover title\n',
        'coverSlide.add(createText("Cover")); // cover title\n\n'
          + 'const blankSlide1 = createSlide({ slideKey: "blank-slide-1", background: { color: "#0B0B0F" } });\n',
      )
      .replace('slides: [coverSlide, closingSlide]', 'slides: [coverSlide, blankSlide1, closingSlide]'));
    expect(typecheckCodegenSource(result.source).ok).toBe(true);
    // 页码切片与 compose 顺序一致：新页成为第 2 页，"Closing" 注释仍归属原结束页之前。
    const ranges = SlideMarkerIndex.build(result.source).listSlides();
    expect(ranges).toHaveLength(3);
    expect(SlideMarkerIndex.build(result.source).sliceSlide(2)).toContain('blank-slide-1');
    expect(SlideMarkerIndex.build(result.source).sliceSlide(2)).toContain('// ── Closing ──');
  });

  it('追加到末页时声明早于求值 slides 数组的语句，并沿用多行数组格式', () => {
    const source = `const a = createSlide();
const b = createSlide();
const slides = [
  a,
  b,
];
compose({ title: "Demo", slides });
`;
    const result = insert(source, 2);

    expect(result.source).toBe(`const a = createSlide();
const b = createSlide();

const blankSlide1 = createSlide({ slideKey: "blank-slide-1", background: { color: "#0B0B0F" } });
const slides = [
  a,
  b,
  blankSlide1,
];
compose({ title: "Demo", slides });
`);
    expect(typecheckCodegenSource(result.source).ok).toBe(true);
  });

  it('插入到首页之前时不移动文件头注释', () => {
    const source = `// deck header
const a = createSlide();
compose({ slides: [a] });
`;
    const result = insert(source, 0, 1);

    expect(result.source).toBe(`// deck header
const blankSlide1 = createSlide({ slideKey: "blank-slide-1", background: { color: "#0B0B0F" } });

const a = createSlide();
compose({ slides: [blankSlide1, a] });
`);
  });

  it('避让源码中已经出现的变量名和页面 key', () => {
    const source = `const blankSlide1 = createSlide({ slideKey: "intro" });
const outro = createSlide({ slideKey: "blank-slide-2" });
compose({ slides: [blankSlide1, outro] });
`;
    const result = insert(source, 2);

    expect(result).toMatchObject({ variableName: 'blankSlide3', slideKey: 'blank-slide-3' });
    expect(result.source).toContain('slides: [blankSlide1, outro, blankSlide3]');
  });

  it('拒绝无法证明页面顺序的结构，而不是猜测插入位置', () => {
    expect(readCode(() => insert('const a = createSlide();\n', 0, 1))).toBe('compose_not_found');
    expect(readCode(() => insert(
      'const a = createSlide();\ncompose({ slides: [a] });\ncompose({ slides: [a] });\n', 0, 1,
    ))).toBe('compose_ambiguous');
    expect(readCode(() => insert(
      'const a = createSlide();\nconst rest = [a];\ncompose({ slides: [...rest] });\n', 0, 1,
    ))).toBe('slides_not_static');
    expect(readCode(() => insert(
      'const a = createSlide();\ncompose({ slides: [a, createSlide()] });\n', 0, 2,
    ))).toBe('slides_not_static');
    expect(readCode(() => insert(
      'const a = createSlide();\nconst list = [a];\nlist.push(createSlide());\ncompose({ slides: list });\n', 0, 2,
    ))).toBe('slides_not_static');
    expect(readCode(() => insert(
      'const make = () => createSlide();\nconst a = make();\ncompose({ slides: [a] });\n', 0, 1,
    ))).toBe('slide_declaration_invalid');
    expect(readCode(() => insert(TWO_SLIDE_SOURCE, 3))).toBe('insert_index_invalid');
    expect(readCode(() => insertBlankSlideIntoDeckSource(TWO_SLIDE_SOURCE, {
      index: 1, slideCount: 2, backgroundColor: '#FFFFFF', maxSourceBytes: TWO_SLIDE_SOURCE.length,
    }))).toBe('source_too_large');
  });
});

describe('resolveInsertedSlideBackgroundColor', () => {
  it('沿用主题页面背景，未声明时使用默认白色', () => {
    expect(resolveInsertedSlideBackgroundColor({ colors: { background: '#0b0b0f' } })).toBe('#0B0B0F');
    expect(resolveInsertedSlideBackgroundColor({ colors: { accent1: '#112233' } })).toBe('#FFFFFF');
    expect(resolveInsertedSlideBackgroundColor(undefined)).toBe('#FFFFFF');
  });
});
