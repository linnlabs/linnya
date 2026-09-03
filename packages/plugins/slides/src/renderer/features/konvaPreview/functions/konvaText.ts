import {
  resolveBrowserFontStack,
  type BrowserFontStackResolution,
} from '@linnya/renderer-ui/font-stack';

export type RenderableFontResolution = BrowserFontStackResolution;

export function resolveRenderableFontFamily(fontFamily?: string, sampleText?: string): string {
  return resolveRenderableFont(fontFamily, sampleText).resolvedFamily;
}

/**
 * 只生成确定性的 CSS 字体栈，不在不同 renderer 宿主里分别探测字体。
 * 浏览器负责从同一栈中选择本机可用字体，后端 resolvedFontFamily 仍优先。
 */
export function resolveRenderableFont(
  fontFamily?: string,
  sampleText?: string,
): RenderableFontResolution {
  return resolveBrowserFontStack(fontFamily, sampleText);
}
