import type { CanvasAppearance } from '../kernel';
import type { CanvasPreferences } from '../features/materialSetting';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { readCanvasChrome } from './readCanvasChrome';
/** 画布内读取深浅主题的唯一入口；默认读当前文档，跨文档挂载的 DOM 传其 ownerDocument。 */
export function readCanvasIsDark(source: Document = document): boolean {
  return source.documentElement.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark';
}
export function readCanvasAppearance(preferences: CanvasPreferences): CanvasAppearance {
  return {
    dark: readCanvasIsDark(),
    material: preferences.material,
    overview: preferences.overview,
    chrome: readCanvasChrome(),
  };
}
