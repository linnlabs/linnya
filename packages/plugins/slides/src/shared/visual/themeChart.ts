/**
 * 图表调色板合同。
 *
 * 图表调色板是 deck/theme 级显式配置，不应由 exporter / parser / renderer
 * 各自维护业务默认值。
 */

export type ThemeChartPalette = [string, ...string[]];

export interface ThemeChartSpec {
  palette: ThemeChartPalette;
}

export interface ThemeChartPaletteLike {
  colors?: Record<string, string>;
  chart?: {
    palette?: readonly string[];
  };
}

export const DEFAULT_THEME_CHART_PALETTE: ThemeChartPalette = [
  '#B64646',
  '#4776B1',
  '#59714B',
  '#7A548E',
  '#41A5B4',
  '#D88C3A',
];

function normalizeHexColor(color: string): string {
  return color.startsWith('#') ? color.toUpperCase() : `#${color.toUpperCase()}`;
}

function toNonEmptyPalette(palette: readonly string[]): ThemeChartPalette {
  const [first, ...rest] = palette.map(normalizeHexColor);
  return [first, ...rest];
}

export function deriveChartPaletteFromThemeColors(
  colors?: Record<string, string>,
): ThemeChartPalette {
  return [
    normalizeHexColor(colors?.accent2 ?? DEFAULT_THEME_CHART_PALETTE[0]),
    normalizeHexColor(colors?.accent1 ?? DEFAULT_THEME_CHART_PALETTE[1]),
    normalizeHexColor(colors?.accent3 ?? DEFAULT_THEME_CHART_PALETTE[2]),
    normalizeHexColor(colors?.accent4 ?? DEFAULT_THEME_CHART_PALETTE[3]),
    normalizeHexColor(colors?.accent5 ?? DEFAULT_THEME_CHART_PALETTE[4]),
    normalizeHexColor(colors?.accent6 ?? DEFAULT_THEME_CHART_PALETTE[5]),
  ];
}

export function resolveThemeChartPalette(
  theme?: ThemeChartPaletteLike,
): ThemeChartPalette {
  const explicitPalette = theme?.chart?.palette;
  if (explicitPalette && explicitPalette.length > 0) {
    return toNonEmptyPalette(explicitPalette);
  }

  return deriveChartPaletteFromThemeColors(theme?.colors);
}
