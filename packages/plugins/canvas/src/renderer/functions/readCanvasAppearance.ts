import type { CanvasAppearance } from '../kernel';
import type { CanvasPreferences } from '../features/materialSetting';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { readCanvasChrome } from './readCanvasChrome';
export function readCanvasIsDark(): boolean {
  return document.documentElement.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark';
}
export function readCanvasAppearance(preferences: CanvasPreferences): CanvasAppearance {
  return {
    dark: readCanvasIsDark(),
    material: preferences.material,
    overview: preferences.overview,
    chrome: readCanvasChrome(),
  };
}
