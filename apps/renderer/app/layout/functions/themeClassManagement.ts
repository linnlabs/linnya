import {
  DEFAULT_RENDERER_UI_THEME,
  isRendererUiTheme,
  RENDERER_UI_THEME_ATTRIBUTE,
  type RendererUiTheme,
} from '@linnya/renderer-ui/theme';

export function normalizeStoredTheme(theme: string): RendererUiTheme {
  if (isRendererUiTheme(theme)) {
    return theme;
  }

  // 旧 green/pink/brown 主题已经从设置入口下线；持久化残留统一迁移到默认主题。
  return DEFAULT_RENDERER_UI_THEME;
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
