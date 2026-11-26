/**
 * Web 域与 Electron 渲染端共享的 DOM 选择器、采样与浏览器内采集结果合同。
 * 主区、隐藏属性与控件选择器在这里只有一份；页面外围的判定在浏览器端依赖计算样式，
 * 规则写在采集脚本里（见 buildRenderCaptureScripts.ts 的 isElementInChrome）。
 */

export const READABLE_MAIN_SELECTOR = 'article, main, [role="main"]';
export const READABLE_HIDDEN_SELECTOR = '[hidden], [aria-hidden="true" i]';
export const READABLE_CONTROL_SELECTOR = 'button, [role="button"]';

export const RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE =
  '(?:recaptcha|hcaptcha|turnstile|doubleclick\\.net|googlesyndication\\.com|googletagmanager\\.com|googleadservices\\.com)';

export interface BrowserReadinessSample {
  readonly readyState: string;
  readonly textLength: number;
  readonly mainTextLength: number;
  readonly scriptCount: number;
}

export interface BrowserScrollProbe {
  readonly scrollY: number;
  readonly scrollHeight: number;
  readonly viewportHeight: number;
  readonly mainTextLength: number;
  readonly atBottom: boolean;
}

export type BrowserCaptureAccessBarrier = 'login_required' | 'captcha';

export const BROWSER_CAPTURE_WARNING_VALUES = [
  'inlined_same_origin_iframe',
  'lazy_content_incomplete',
  'capture_truncated',
] as const;

export type BrowserCaptureWarning = (typeof BROWSER_CAPTURE_WARNING_VALUES)[number];

export interface BrowserCapturedFrameResource {
  readonly kind: 'source';
  readonly url: string;
  readonly label?: string;
}

export interface BrowserCapturePayload {
  readonly html: string;
  readonly accessBarrier?: BrowserCaptureAccessBarrier;
  readonly warnings: readonly BrowserCaptureWarning[];
  readonly inlinedFrameResources: readonly BrowserCapturedFrameResource[];
  readonly mainTextLength: number;
}
