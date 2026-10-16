import {
  DEFAULT_RENDERER_UI_THEME,
  isRendererUiTheme,
  RENDERER_UI_THEME_ATTRIBUTE,
  type RendererUiTheme,
} from '@linnya/renderer-ui/theme';
import type { ThemePreference } from '@/shared/stores/ui';

/** 系统外观的媒体查询；Electron 默认跟随操作系统的浅色 / 深色设置。 */
export const SYSTEM_DARK_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function normalizeStoredTheme(theme: string): ThemePreference {
  if (theme === 'system' || isRendererUiTheme(theme)) {
    return theme;
  }

  // 旧 green/pink/brown 主题已经从设置入口下线；持久化残留统一迁移到默认主题。
  return DEFAULT_RENDERER_UI_THEME;
}

/** 跟随系统只在浅色与深色之间切换；月白蓝是用户显式选择的浅色变体。 */
export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): RendererUiTheme {
  if (preference !== 'system') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

export interface ThemeDomStyle {
  backgroundColor: string;
  color: string;
}

export interface ThemeDomElement {
  style: ThemeDomStyle;
}

export interface ThemeDomTargets {
  root: ThemeDomElement & {
    setAttribute(name: string, value: string): void;
  };
  body: ThemeDomElement;
}

export function clearThemeInlineStyles(targets: ThemeDomTargets): void {
  targets.body.style.backgroundColor = '';
  targets.body.style.color = '';
  targets.root.style.backgroundColor = '';
  targets.root.style.color = '';
}

export function applyThemeToDom(theme: RendererUiTheme, targets: ThemeDomTargets): void {
  targets.root.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, theme);
  clearThemeInlineStyles(targets);
}
