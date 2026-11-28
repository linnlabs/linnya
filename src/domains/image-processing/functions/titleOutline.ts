import type { FontKitBBox, FontKitFont, FontKitPath } from 'fontkit';
import type { TitleDirection } from '../definitions/imageProcessing';

export interface TitleOutline {
  /** 已平移到从 (0,0) 开始的 SVG path 数据。 */
  readonly d: string;
  readonly width: number;
  readonly height: number;
}

/** 轮廓坐标保留一位小数：标题以几百像素一个字渲染，0.1px 的误差看不出，SVG 体积能省一半。 */
function roundPathData(d: string): string {
  return d.replace(/-?\d+\.\d+/gu, value => String(Math.round(Number(value) * 10) / 10));
}

/** 标题用到的字里，字体没有字形的（空白不算），按首次出现的顺序去重。 */
export function missingGlyphs(font: FontKitFont, text: string): string[] {
  const missing = new Set<string>();
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && !/\s/u.test(character) && !font.hasGlyphForCodePoint(codePoint)) missing.add(character);
  }
  return [...missing];
}

/**
 * 把标题排成字形轮廓。横排按字体自己的排版（字距调整、连字都生效）；竖排逐字从上到下，每个字在 em 宽的一列里居中，
 * 标点用字体的竖排字形（`vert` 特性）。`size` 是一个 em 的像素数；`padding` 留给加粗描边和抗锯齿。
 */
export function titleOutline(font: FontKitFont, text: string, size: number, direction: TitleDirection, padding: number): TitleOutline {
  const scale = size / font.unitsPerEm;
  const placed: FontKitPath[] = [];
  const box: FontKitBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const place = (glyphPath: FontKitPath, x: number, y: number) => {
    // 字体坐标 y 向上，SVG 向下：先按 em 缩放并翻转，再挪到基线位置
    const path = glyphPath.scale(scale, -scale).translate(x, y);
    const bbox = path.bbox;
    // 空格之类没有轮廓的字形只占位置，不参与范围
    if (!Number.isFinite(bbox.minX)) return;
    box.minX = Math.min(box.minX, bbox.minX);
    box.minY = Math.min(box.minY, bbox.minY);
    box.maxX = Math.max(box.maxX, bbox.maxX);
    box.maxY = Math.max(box.maxY, bbox.maxY);
    placed.push(path);
  };
  const baseline = font.ascent * scale;
  if (direction === 'horizontal') {
    const run = font.layout(text);
    let x = 0;
    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index];
      place(glyph.path, x + position.xOffset * scale, baseline - position.yOffset * scale);
      x += position.xAdvance * scale;
    });
  } else {
    const cell = (font.ascent - font.descent) * scale;
    let top = 0;
    for (const character of text) {
      if (/\s/u.test(character)) {
        top += cell / 2;
        continue;
      }
      const run = font.layout(character, ['vert']);
      for (const glyph of run.glyphs) place(glyph.path, (size - glyph.advanceWidth * scale) / 2, top + baseline);
      top += cell;
    }
  }
  if (placed.length === 0) return { d: '', width: 0, height: 0 };
  // 整体平移到从 padding 开始，viewBox 才能从 0 起
  const d = roundPathData(placed.map(path => path.translate(padding - box.minX, padding - box.minY).toSVG()).join(''));
  return {
    d,
    width: Math.ceil(box.maxX - box.minX + padding * 2),
    height: Math.ceil(box.maxY - box.minY + padding * 2),
  };
}
