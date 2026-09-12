import type PptxGenJS from 'pptxgenjs';
import {
  resolveThemeChartPalette,
  toPptxHexColor,
  DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
  type Box,
  type ImageVisualShadow,
  type ShapeStyle,
  type TableCell as DomainTableCell,
  type TextStyle,
  type TextLineSpacing,
  type ThemeChartPalette,
  type ThemeChartPaletteLike,
} from '@plugin/slides/shared';

interface ThemeLike extends ThemeChartPaletteLike {
  fonts?: {
    major?: string;
    minor?: string;
  };
}

export interface ResolvedThemeFonts {
  major: string;
  minor: string;
}

export interface ShapeTextLayout {
  fontSize: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  marginPoints: [number, number, number, number];
  paddingInches: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

const DEFAULT_THEME_FONTS: ResolvedThemeFonts = {
  major: 'Calibri Light',
  minor: 'Calibri',
};

export function resolveThemeFonts(theme?: ThemeLike): ResolvedThemeFonts {
  return {
    major: theme?.fonts?.major ?? DEFAULT_THEME_FONTS.major,
    minor: theme?.fonts?.minor ?? DEFAULT_THEME_FONTS.minor,
  };
}

export function resolveChartPalette(theme?: ThemeLike): ThemeChartPalette {
  return resolveThemeChartPalette(theme);
}

export function buildTableColumnWidths(
  totalWidth: number,
  headers: string[] | undefined,
  rows: DomainTableCell[][],
): number[] | undefined {
  if (rows.some((row) => row.some((cell) => cell.colspan != null || cell.rowspan != null))) {
    return undefined;
  }
  const columnCount = headers?.length ?? rows[0]?.length ?? 0;
  if (columnCount <= 1) return undefined;
  if (rows.some((row) => row.length !== columnCount)) return undefined;

  const weights = Array.from({ length: columnCount }, (_, index) => {
    const headerWeight = (headers?.[index]?.length ?? 0) * 1.1;
    const maxCell = rows.reduce((max, row) => Math.max(max, row[index]?.text.length ?? 0), 0);
    const multilineBias = rows.reduce((sum, row) => sum + ((row[index]?.text.includes(' ') ?? false) ? 2 : 0), 0);
    return Math.max(8, headerWeight, maxCell + multilineBias + 6);
  });

  if (columnCount === 4) {
    weights[0] *= 1.08;
    weights[1] *= 0.95;
    weights[2] *= 0.82;
    weights[3] *= 1.38;
  } else if (columnCount === 5) {
    weights[0] *= 1.18;
    weights[1] *= 0.92;
    weights[2] *= 0.82;
    weights[3] *= 0.82;
    weights[4] *= 1.55;
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => Number(((weight / totalWeight) * totalWidth).toFixed(3)));
}

export function estimateTableDensity(
  headers: string[] | undefined,
  rows: DomainTableCell[][],
): number {
  const headerChars = (headers ?? []).reduce((sum, header) => sum + header.length, 0);
  const rowChars = rows.reduce(
    (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + cell.text.length, 0),
    0,
  );
  return headerChars + rowChars + rows.length * Math.max(1, headers?.length ?? rows[0]?.length ?? 1) * 8;
}

export function resolveGeneratedRenderChartType(chartType: string | undefined): string {
  if (chartType === 'bar') {
    return 'column';
  }
  return chartType ?? 'column';
}

/** 将 value 限制在 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function estimateShapeTextFontSize(
  box: Box,
  text: string,
  rotated: boolean,
): number {
  const lines = text.split('\n').length;
  const longestLine = Math.max(...text.split('\n').map((line) => line.trim().length), 0);

  let size = 16;
  if (box.h <= 0.45) size = 8;
  else if (box.h <= 0.65) size = 9;
  else if (box.h <= 0.95) size = 10;
  else if (box.h <= 1.3) size = 11;
  else if (box.h <= 1.8) size = 12;
  else if (box.h <= 2.4) size = 13;

  if (lines >= 3) size -= 1;
  if (lines >= 4) size -= 1;
  if (longestLine >= 28) size -= 1;
  if (longestLine >= 40) size -= 1;
  if (rotated) size -= 1;
  if (box.w <= 1.4) size -= 1;

  return clamp(size, 8, 18);
}

export function resolveShapeTextLayout(
  box: Box,
  text: string,
  style?: TextStyle,
  rotated = false,
): ShapeTextLayout {
  const lines = text.split('\n').length;
  const longestLine = Math.max(...text.split('\n').map((line) => line.trim().length), 0);
  const multiline = lines > 1 || longestLine > 24;
  const compact = box.w <= 1.6 || box.h <= 0.55;

  return {
    fontSize: style?.fontSize ?? estimateShapeTextFontSize(box, text, rotated),
    align: multiline && !rotated ? 'left' : (style?.align ?? 'center'),
    valign: multiline && !rotated ? 'top' : (style?.valign ?? 'middle'),
    marginPoints: compact ? [2, 4, 2, 4] : [6, 8, 6, 8],
    paddingInches: compact
      ? { top: 2 / 72, right: 4 / 72, bottom: 2 / 72, left: 4 / 72 }
      : { top: 6 / 72, right: 8 / 72, bottom: 6 / 72, left: 8 / 72 },
  };
}

/** 将 ImageVisualShadow 领域模型转换为 PptxGenJS 阴影属性 */
export function mapImageShadowToProps(shadow: ImageVisualShadow): PptxGenJS.ShadowProps {
  return {
    type: 'outer',
    color: stripHash(shadow.color ?? '#000000', 'shadow.color'),
    blur: shadow.blur ?? 0,
    angle: shadow.angle ?? 45,
    offset: shadow.distance ?? 0,
    opacity: shadow.opacity ?? 0.3,
  };
}

/** 去掉颜色字符串的 # 前缀，并强制要求规范化十六进制颜色。 */
export function stripHash(color: string, path = 'color'): string {
  return toPptxHexColor(color, path);
}

/** 从 Box 领域对象提取 PptxGenJS 坐标 */
export function mapPosition(box: Box): { x: number; y: number; w: number; h: number } {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

// ─── Structured / Freeform 编译器共享的 PptxGenJS 映射 ────────────────────────

export type ResolvedTextLineSpacing =
  | { kind: 'points'; points: number }
  | { kind: 'multiple'; multiple: number };

export function resolveTextLineSpacing(
  lineSpacing: TextLineSpacing | undefined,
): ResolvedTextLineSpacing | undefined {
  if (lineSpacing == null) {
    return undefined;
  }
  if (lineSpacing.kind === 'exactPt') {
    return { kind: 'points', points: lineSpacing.value };
  }
  return { kind: 'multiple', multiple: lineSpacing.value };
}

export function resolveTextLineHeightMultiplier(
  lineSpacing: TextLineSpacing | undefined,
  fontSize: number | undefined,
): number | undefined {
  const resolved = resolveTextLineSpacing(lineSpacing);
  if (!resolved) {
    return undefined;
  }
  if (resolved.kind === 'multiple') {
    return resolved.multiple;
  }
  if (fontSize != null && fontSize > 0) {
    return resolved.points / fontSize;
  }
  return undefined;
}

/** 仅映射 run 级文本属性，禁止把段落级行距重复写进每个 rich-text run。 */
export function mapTextRunStyleToProps(style?: TextStyle): Record<string, unknown> {
  if (!style) return {};
  const opts: Record<string, unknown> = {};
  if (style.fontSize != null) opts.fontSize = style.fontSize;
  if (style.fontFamily) opts.fontFace = style.fontFamily;
  if (style.bold != null) opts.bold = style.bold;
  if (style.italic != null) opts.italic = style.italic;
  if (style.underline != null) opts.underline = style.underline;
  if (style.color) opts.color = stripHash(style.color, 'text.color');
  if (style.letterSpacing != null) opts.charSpacing = style.letterSpacing;
  return opts;
}

/** 映射文本框/段落级属性；生成内容没有显式行距时统一写出 1.0 倍。 */
export function mapTextParagraphStyleToProps(style?: TextStyle): Record<string, unknown> {
  const opts = mapTextRunStyleToProps(style);
  if (style?.align) opts.align = style.align;
  if (style?.valign) opts.valign = style.valign;
  return { ...opts, ...mapTextParagraphLineSpacingToProps(style) };
}

/** PptxGenJS rich text 需要只在首个 run 前写一次 pPr，故单独暴露段落行距片段。 */
export function mapTextParagraphLineSpacingToProps(style?: TextStyle): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  const lineSpacing = resolveTextLineSpacing(style?.lineSpacing);
  if (!lineSpacing) {
    opts.lineSpacingMultiple = DEFAULT_TEXT_LINE_SPACING_MULTIPLE;
    return opts;
  }
  if (lineSpacing.kind === 'points') {
    opts.lineSpacing = lineSpacing.points;
    return opts;
  }
  opts.lineSpacingMultiple = lineSpacing.multiple;
  return opts;
}

/** ShapeStyle['shadow'] → PptxGenJS.ShadowProps（直角坐标 offsetX/Y → 极坐标 angle/offset） */
export function mapShapeShadowToProps(shadow: NonNullable<ShapeStyle['shadow']>): PptxGenJS.ShadowProps {
  const angle = Math.atan2(shadow.offsetY, shadow.offsetX) * (180 / Math.PI);
  const offset = Math.sqrt(shadow.offsetX ** 2 + shadow.offsetY ** 2);
  return {
    type: 'outer',
    color: stripHash(shadow.color, 'shadow.color'),
    blur: shadow.blur,
    angle: Math.round(angle),
    offset: Math.round(offset),
    opacity: shadow.opacity ?? 0.4,
  };
}

/** ShapeStyle['border'] → PptxGenJS.ShapeLineProps */
export function mapBorderToLineProps(border: NonNullable<ShapeStyle['border']>): PptxGenJS.ShapeLineProps {
  if (!border.color) {
    throw new Error('渐变描边必须由原生 OOXML Paint adapter 写入。');
  }
  const line: PptxGenJS.ShapeLineProps = {
    color: stripHash(border.color, 'border.color'),
    width: border.width,
  };
  if (border.dash) {
    const dashMap: Record<string, PptxGenJS.ShapeLineProps['dashType']> = {
      solid: 'solid',
      dash: 'dash',
      dot: 'sysDot',
    };
    line.dashType = dashMap[border.dash] ?? 'solid';
  }
  return line;
}
