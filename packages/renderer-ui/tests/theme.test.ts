import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_RENDERER_UI_THEMES,
  DEFAULT_RENDERER_UI_THEME,
  getRendererUiThemeSelector,
  isRendererUiTheme,
  RENDERER_UI_THEME_ATTRIBUTE,
} from '../src/theme';

describe('Renderer UI theme contract', () => {
  it('publishes the three built-in themes and the stable root attribute', () => {
    expect(BUILT_IN_RENDERER_UI_THEMES).toEqual(['light', 'dark', 'moon-blue']);
    expect(DEFAULT_RENDERER_UI_THEME).toBe('light');
    expect(RENDERER_UI_THEME_ATTRIBUTE).toBe('data-linnya-ui-theme');
  });

  it.each(BUILT_IN_RENDERER_UI_THEMES)('creates the selector for %s', (theme) => {
    expect(isRendererUiTheme(theme)).toBe(true);
    expect(getRendererUiThemeSelector(theme)).toBe(`[data-linnya-ui-theme='${theme}']`);
  });

  it('rejects removed and unknown theme names', () => {
    expect(isRendererUiTheme('green')).toBe(false);
    expect(isRendererUiTheme('dark-mode')).toBe(false);
  });
});
