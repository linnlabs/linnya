export {
  DEFAULT_THEME_CHART_PALETTE,
  deriveChartPaletteFromThemeColors,
  resolveThemeChartPalette,
} from './themeChart';
export type {
  ThemeChartPalette,
  ThemeChartPaletteLike,
  ThemeChartSpec,
} from './themeChart';
export type {
  ThemeSpec,
} from './themeSpec';
export * from './paint';
export {
  assertCanonicalHexColor,
  normalizeDeckSpecColors,
  normalizeFillColor,
  normalizeFreeformSlideSpecColors,
  normalizeGradientColors,
  normalizeImageShadowColors,
  normalizeOpaqueColor,
  normalizeShapeStyleColors,
  normalizeStructuredSlideSpecColors,
  normalizeTextStyleColors,
  normalizeThemeSpecColors,
  toPptxHexColor,
} from './colorContract';
