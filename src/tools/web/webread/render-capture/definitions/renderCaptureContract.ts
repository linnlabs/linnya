/**
 * Web 域与 Electron 渲染端共享的 DOM 选择器、采样与浏览器内采集结果合同。
 * 保持选择器单一真源，避免“就绪主区”“受保护折叠正文”“噪音隔离”在两端漂移。
 */

export const READABLE_MAIN_SELECTOR = 'article, main, [role="main"]';
export const READABLE_HIDDEN_SELECTOR = '[hidden], [aria-hidden="true" i]';
export const READABLE_CONTROL_SELECTOR = 'button, [role="button"]';

/** 页面壳与外围栏目标记；Electron 侧就绪采样在计算主区长度时直接复用该常量。 */
export const RENDER_READINESS_CHROME_SELECTOR = [
  'header',
  'nav',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="banner"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[inert]',
  '[hidden]',
  '[aria-hidden="true" i]',
].join(', ');

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
