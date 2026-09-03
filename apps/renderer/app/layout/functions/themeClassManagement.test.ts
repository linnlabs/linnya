import { describe, expect, it } from 'vitest';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import {
  applyThemeToDom,
  normalizeStoredTheme,
} from './themeClassManagement';

class TestThemeElement {
  private readonly attributes = new Map<string, string>();

  readonly style = {
    backgroundColor: '',
    color: '',
  };

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

describe('themeClassManagement', () => {
  it('migrates removed theme names to the default theme', () => {
    expect(normalizeStoredTheme('green')).toBe('light');
    expect(normalizeStoredTheme('pink')).toBe('light');
    expect(normalizeStoredTheme('brown')).toBe('light');
    expect(normalizeStoredTheme('light-mode')).toBe('light');
  });

  it('keeps the moon blue stored theme', () => {
    expect(normalizeStoredTheme('moon-blue')).toBe('moon-blue');
  });

  it('applies the light theme to the document root attribute', () => {
    const root = new TestThemeElement();
    const body = new TestThemeElement();

    applyThemeToDom('light', { root, body });

    expect(root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE)).toBe('light');
    expect(body.getAttribute(RENDERER_UI_THEME_ATTRIBUTE)).toBeNull();
  });

  it('replaces the active root theme without writing theme state to body', () => {
    const root = new TestThemeElement();
    const body = new TestThemeElement();

    applyThemeToDom('dark', { root, body });
    applyThemeToDom('moon-blue', { root, body });

    expect(root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE)).toBe('moon-blue');
    expect(body.getAttribute(RENDERER_UI_THEME_ATTRIBUTE)).toBeNull();
  });

  it('clears inline color styles when applying a theme', () => {
    const root = new TestThemeElement();
    const body = new TestThemeElement();
    root.style.backgroundColor = 'red';
    root.style.color = 'blue';
    body.style.backgroundColor = 'green';
    body.style.color = 'yellow';

    applyThemeToDom('dark', { root, body });

    expect(root.style.backgroundColor).toBe('');
    expect(root.style.color).toBe('');
    expect(body.style.backgroundColor).toBe('');
    expect(body.style.color).toBe('');
  });
});
