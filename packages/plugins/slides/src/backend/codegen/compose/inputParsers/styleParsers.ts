/**
 * 样式、几何、渐变、主题的 tool input 解析器。
 * 依赖 typeGuards，不依赖 dataParsers / contentParsers。
 */

import type {
  Box,
  LayoutChartStyle,
  ImageVisualShadow,
  ShapeStyle,
  ShapeStrokeStyle,
  SlideBackgroundGradient,
  TextStyle,
  ThemeSpec,
} from '@plugin/slides/shared';
import {
  normalizeGradientPaint,
  normalizePaint,
  normalizeStrokePaint,
  normalizeThemeSpecColors,
  parseTextLineSpacingInput,
} from '@plugin/slides/shared';
import {
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  parseStringArray,
} from './typeGuards.js';

export type ThemeInput = {
  colors?: Record<string, string>;
  fonts?: Partial<{
    major: string;
    minor: string;
  }>;
  chart?: {
    palette?: string[];
  };
  logo?: string;
};

export function parseTextStyle(value: unknown): TextStyle | null {
  if (!isRecord(value)) return null;
  const style: TextStyle = {};
  if (isFiniteNumber(value.fontSize)) style.fontSize = value.fontSize;
  if (isNonEmptyString(value.fontFamily)) style.fontFamily = value.fontFamily;
  if (typeof value.bold === 'boolean') style.bold = value.bold;
  if (typeof value.italic === 'boolean') style.italic = value.italic;
  if (typeof value.underline === 'boolean') style.underline = value.underline;
  if (isNonEmptyString(value.color)) style.color = value.color;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') {
    style.align = value.align;
  }
  if (value.valign === 'top' || value.valign === 'middle' || value.valign === 'bottom') {
    style.valign = value.valign;
  }
  if (value.lineSpacing != null) {
    const lineSpacing = parseTextLineSpacingInput(value.lineSpacing);
    if (!lineSpacing) return null;
    style.lineSpacing = lineSpacing;
  }
  if (isFiniteNumber(value.letterSpacing)) style.letterSpacing = value.letterSpacing;
  return style;
}

/** 解析 deck.js 公开的图表颜色语义，不接受底层引擎 option。 */
export function parseChartStyle(value: unknown): LayoutChartStyle | null {
  if (!isRecord(value)) return null;
  const style: LayoutChartStyle = {};
  const keys: Array<keyof LayoutChartStyle> = [
    'axisLabelColor',
    'categoryAxisLabelColor',
    'valueAxisLabelColor',
    'dataLabelColor',
    'gridlineColor',
  ];
  const knownKeys = new Set<string>(keys);
  if (Object.keys(value).some((key) => !knownKeys.has(key))) return null;
  for (const key of keys) {
    if (value[key] != null) {
      if (!isNonEmptyString(value[key])) return null;
      style[key] = value[key];
    }
  }
  return Object.keys(style).length > 0 ? style : null;
}

/** 表格沿用统一描边合同，避免再造一套 border 字段。 */
export function parseTableBorder(value: unknown): ShapeStrokeStyle | null {
  if (!isRecord(value) || !Object.keys(value).every(key => key === 'color' || key === 'width')) {
    return null;
  }
  const parsed = parseShapeStyle({ border: value });
  return parsed?.border ?? null;
}

/**
 * `parseTextStyle` / `parseShapeStyle` 各自识别的字段全集，导出给 reader 在
 * 错误消息里回灌"合法字段"——避免 AI 拿到 "style is invalid" 这种零信息错误时
 * 反复试错（审计 `20260419_222120` 教训）。
 *
 * 加新字段必须**同步**修改对应 `parse*` 函数与本常量，二者必须保持同步。
 * 锁死见 `inputParsers/__tests__/styleParsers.knownKeys.test.ts`。
 */
export const KNOWN_TEXT_STYLE_KEYS: readonly string[] = [
  'fontSize',
  'fontFamily',
  'bold',
  'italic',
  'underline',
  'color',
  'align',
  'valign',
  'lineSpacing',
  'letterSpacing',
];

export const KNOWN_SHAPE_STYLE_KEYS: readonly string[] = [
  'fill',
  'paint',
  'gradient',
  'border',
  'borderRadius',
  'shadow',
  'opacity',
  'rotate',
];

export interface ElementStyleSplit {
  shapeStyle?: Partial<ShapeStyle>;
  textStyle?: Partial<TextStyle>;
}

/**
 * 把 element_management 入口的 `style` / `textStyle` 字段拆成 ShapeStyle 与
 * TextStyle 两半。
 *
 * 历史教训（审计 `20260419_222120`）：AI 反复 4 次写
 *   `{ action: "create_text", style: { color, fontSize } }`
 * 都被 `parseShapeStyle` 否决——`color/fontSize` 是 TextStyle 字段。这个 splitter
 * 接受任意混合，自动归类，并在出现完全无法识别的字段时给出含字段全集的错误，
 * 让 AI 一次纠正。
 *
 * 设计：
 * - `style` 里的字段同时尝试 TextStyle / ShapeStyle 集合归类
 * - `textStyle` 里的字段必须在 TextStyle 集合内（否则视为 unknown）
 * - 任意 unknown 字段 → 单条错误，列出已识别 + 已知字段全集
 * - 若某半字段集类型校验失败（如 fontSize 传字符串），会回报具体哪一半无效
 */
export function splitElementStyleInput(
  styleInput: unknown,
  textStyleInput: unknown,
  context: string,
): { value: ElementStyleSplit } | { error: string } {
  const styleRecord = styleInput == null ? null : isRecord(styleInput) ? styleInput : undefined;
  const textStyleRecord = textStyleInput == null ? null : isRecord(textStyleInput) ? textStyleInput : undefined;

  if (styleRecord === undefined) {
    return { error: `${context}：style 必须是对象（如 { fill: "#000", opacity: 0.4 }）。` };
  }
  if (textStyleRecord === undefined) {
    return { error: `${context}：textStyle 必须是对象（如 { fontSize: 16, color: "#FFF" }）。` };
  }

  const textPortion: Record<string, unknown> = {};
  const shapePortion: Record<string, unknown> = {};
  const unknown: string[] = [];

  const textKeySet = new Set(KNOWN_TEXT_STYLE_KEYS);
  const shapeKeySet = new Set(KNOWN_SHAPE_STYLE_KEYS);

  if (styleRecord) {
    for (const [key, value] of Object.entries(styleRecord)) {
      if (textKeySet.has(key)) {
        textPortion[key] = value;
      } else if (shapeKeySet.has(key)) {
        shapePortion[key] = value;
      } else {
        unknown.push(`style.${key}`);
      }
    }
  }
  if (textStyleRecord) {
    for (const [key, value] of Object.entries(textStyleRecord)) {
      if (textKeySet.has(key)) {
        // 显式 textStyle 优先于 style 中的同名键：AI 先写 style，又显式补 textStyle 时取后者
        textPortion[key] = value;
      } else {
        unknown.push(`textStyle.${key}`);
      }
    }
  }

  if (unknown.length > 0) {
    return {
      error: [
        `${context}：style / textStyle 中出现无法识别的字段：${unknown.join(', ')}。`,
        `合法 TextStyle 字段：${KNOWN_TEXT_STYLE_KEYS.join(' | ')}（用于文本 / 形状内文字）。`,
        `合法 ShapeStyle 字段：${KNOWN_SHAPE_STYLE_KEYS.join(' | ')}（用于形状 / 边框 / 阴影 / 不透明度）。`,
        '提示：写在 style 还是 textStyle 都可，reader 会按字段名自动归类。',
      ].join('\n'),
    };
  }

  const shapeKeysPresent = Object.keys(shapePortion).length > 0;
  const textKeysPresent = Object.keys(textPortion).length > 0;

  const shapeStyle = shapeKeysPresent ? parseShapeStyle(shapePortion) ?? undefined : undefined;
  if (shapeKeysPresent && !shapeStyle) {
    return {
      error: `${context}：ShapeStyle 字段值类型无效（涉及 ${Object.keys(shapePortion).join(', ')}）。例如 opacity 必须是数字、fill 必须是 "#RRGGBB" 字符串、border 必须是 { color, width } 对象。`,
    };
  }
  const textStyle = textKeysPresent ? parseTextStyle(textPortion) ?? undefined : undefined;
  if (textKeysPresent && !textStyle) {
    return {
      error: `${context}：TextStyle 字段值类型无效（涉及 ${Object.keys(textPortion).join(', ')}）。例如 fontSize 必须是数字、color 必须是 "#RRGGBB"、align 必须是 "left"|"center"|"right"。`,
    };
  }

  return { value: { shapeStyle, textStyle } };
}

/**
 * 解析 ImageVisualShadow（color/blur/angle/distance/opacity）。
 *
 * 单位契约（参考 §4.4）：`distance` = pt，`angle` = 度（极坐标，0° = 向右逆时针）。
 *
 * 容错宽于 ShapeStyle.shadow：缺字段时返回剩余可识别字段的部分对象，
 * 全部字段缺失则返回 null（与 generated/edit 两条入口保持一致）。
 */
export function parseImageVisualShadow(value: unknown): ImageVisualShadow | null {
  if (!isRecord(value)) return null;
  const shadow: ImageVisualShadow = {};
  if (value.color != null) {
    if (!isNonEmptyString(value.color)) return null;
    shadow.color = value.color;
  }
  if (value.blur != null) {
    if (!isFiniteNumber(value.blur)) return null;
    shadow.blur = value.blur;
  }
  if (value.angle != null) {
    if (!isFiniteNumber(value.angle)) return null;
    shadow.angle = value.angle;
  }
  if (value.distance != null) {
    if (!isFiniteNumber(value.distance)) return null;
    shadow.distance = value.distance;
  }
  if (value.opacity != null) {
    if (!isFiniteNumber(value.opacity)) return null;
    shadow.opacity = value.opacity;
  }
  return Object.keys(shadow).length > 0 ? shadow : null;
}

export function parsePartialBox(value: unknown): Partial<Box> | null {
  if (!isRecord(value)) return null;
  const box: Partial<Box> = {};
  if (value.x != null) {
    if (!isFiniteNumber(value.x)) return null;
    box.x = value.x;
  }
  if (value.y != null) {
    if (!isFiniteNumber(value.y)) return null;
    box.y = value.y;
  }
  if (value.w != null) {
    if (!isFiniteNumber(value.w)) return null;
    box.w = value.w;
  }
  if (value.h != null) {
    if (!isFiniteNumber(value.h)) return null;
    box.h = value.h;
  }
  return Object.keys(box).length > 0 ? box : null;
}

export function parseShapeStyle(value: unknown): Partial<ShapeStyle> | null {
  if (!isRecord(value)) return null;
  const style: Partial<ShapeStyle> = {};
  if (value.fill != null) {
    if (!isNonEmptyString(value.fill)) return null;
    style.fill = value.fill;
  }
  if (value.paint != null) {
    const paint = normalizePaint(value.paint, 'style.paint');
    if ('error' in paint) return null;
    style.paint = paint.value;
  }
  if (value.gradient != null) {
    const gradient = normalizeGradientPaint(value.gradient, 'style.gradient');
    if ('error' in gradient) return null;
    style.gradient = gradient.value;
  }
  if (value.border != null) {
    if (!isRecord(value.border) || !isFiniteNumber(value.border.width)) {
      return null;
    }
    if (
      value.border.dash != null
      && value.border.dash !== 'solid'
      && value.border.dash !== 'dash'
      && value.border.dash !== 'dot'
    ) {
      return null;
    }
    const dash = value.border.dash === 'solid'
      || value.border.dash === 'dash'
      || value.border.dash === 'dot'
      ? value.border.dash
      : undefined;
    if (value.border.color != null && value.border.paint != null) return null;
    const paint = value.border.paint != null
      ? normalizeStrokePaint(value.border.paint, 'style.border.paint')
      : isNonEmptyString(value.border.color)
        ? { value: { type: 'solid' as const, color: value.border.color } }
        : null;
    if (!paint || 'error' in paint) return null;
    style.border = {
      paint: paint.value,
      width: value.border.width,
      dash,
    };
  }
  if (value.borderRadius != null) {
    if (!isFiniteNumber(value.borderRadius)) return null;
    style.borderRadius = value.borderRadius;
  }
  if (value.shadow != null) {
    if (
      !isRecord(value.shadow)
      || !isNonEmptyString(value.shadow.color)
      || !isFiniteNumber(value.shadow.blur)
      || !isFiniteNumber(value.shadow.offsetX)
      || !isFiniteNumber(value.shadow.offsetY)
    ) {
      return null;
    }
    if (value.shadow.opacity != null && !isFiniteNumber(value.shadow.opacity)) {
      return null;
    }
    style.shadow = {
      color: value.shadow.color,
      blur: value.shadow.blur,
      offsetX: value.shadow.offsetX,
      offsetY: value.shadow.offsetY,
      opacity: isFiniteNumber(value.shadow.opacity) ? value.shadow.opacity : undefined,
    };
  }
  if (value.opacity != null) {
    if (!isFiniteNumber(value.opacity)) return null;
    style.opacity = value.opacity;
  }
  if (value.rotate != null) {
    if (!isFiniteNumber(value.rotate)) return null;
    style.rotate = value.rotate;
  }
  return Object.keys(style).length > 0 ? style : null;
}

export function readThemeSpecInput(
  value: unknown,
): { theme?: ThemeSpec; error?: string } {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    return { error: 'theme 必须是对象。' };
  }

  const theme: ThemeSpec = {};

  if (value.colors != null) {
    if (!isRecord(value.colors)) {
      return { error: 'theme.colors 必须是字符串键值对。' };
    }
    const colors: Record<string, string> = {};
    for (const [key, colorValue] of Object.entries(value.colors)) {
      if (!isNonEmptyString(colorValue)) {
        return { error: 'theme.colors 的值必须是非空字符串。' };
      }
      colors[key] = colorValue;
    }
    theme.colors = colors;
  }

  if (value.fonts != null) {
    if (!isRecord(value.fonts)) {
      return { error: 'theme.fonts 必须是对象。' };
    }
    const major = isNonEmptyString(value.fonts.major) ? value.fonts.major : undefined;
    const minor = isNonEmptyString(value.fonts.minor) ? value.fonts.minor : undefined;
    if (major && minor) {
      theme.fonts = { major, minor };
    } else if (major || minor) {
      return { error: 'theme.fonts.major 和 theme.fonts.minor 必须同时提供。' };
    }
  }

  if (value.chart != null) {
    if (!isRecord(value.chart)) {
      return { error: 'theme.chart 必须是对象。' };
    }
    if (value.chart.palette != null) {
      const palette = parseStringArray(value.chart.palette);
      if (!palette || palette.length === 0) {
        return { error: 'theme.chart.palette 必须是非空字符串数组。' };
      }
      theme.chart = { palette: [palette[0], ...palette.slice(1)] };
    }
  }

  if (value.logo != null) {
    if (!isNonEmptyString(value.logo)) {
      return { error: 'theme.logo 必须是非空字符串。' };
    }
    theme.logo = value.logo;
  }

  const normalizedTheme = normalizeThemeSpecColors(theme);
  if ('error' in normalizedTheme) {
    return { error: normalizedTheme.error };
  }

  return { theme: normalizedTheme.value };
}
