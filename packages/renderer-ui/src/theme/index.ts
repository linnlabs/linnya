export const BUILT_IN_RENDERER_UI_THEMES = ['light', 'dark', 'moon-blue'] as const;

export type RendererUiTheme = typeof BUILT_IN_RENDERER_UI_THEMES[number];

export const DEFAULT_RENDERER_UI_THEME: RendererUiTheme = 'light';
export const RENDERER_UI_THEME_ATTRIBUTE = 'data-linnya-ui-theme';

export function isRendererUiTheme(theme: string): theme is RendererUiTheme {
  return BUILT_IN_RENDERER_UI_THEMES.some(candidate => candidate === theme);
}

export function getRendererUiThemeSelector(theme: RendererUiTheme): string {
  return `[${RENDERER_UI_THEME_ATTRIBUTE}='${theme}']`;
}
