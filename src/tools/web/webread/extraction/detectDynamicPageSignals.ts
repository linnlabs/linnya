import { getDomain } from 'tldts';
import type { WebDocumentWarning, WebPageResource } from '../../definitions/webDocument';
import { assertAllowedWebUrl, WebUrlPolicyError } from '../../shared/urlPolicy';
import { WEB_READ_SUBSTANTIAL_CONTENT_CHARS } from '../definitions/readLadder';
import { normalizeExtractedText } from './extractSemanticDom';
import { isExplicitlyHidden } from './prepareReadableDocument';
import {
  READABLE_MAIN_SELECTOR,
  RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE,
} from '../render-capture/definitions/renderCaptureContract';

const FRAME_EXCLUDED_CONTAINER_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'header',
  '[inert]',
  '[hidden]',
  '[aria-hidden="true" i]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="banner"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
].join(', ');

const SHELL_CHROME_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'header',
  '[inert]',
  '[hidden]',
  '[aria-hidden="true" i]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="banner"]',
  '[role="dialog"]',
].join(', ');

const MAIN_REGION_SELECTOR = READABLE_MAIN_SELECTOR;
const EMPTY_MOUNT_SELECTOR = '#app, #root, #__next, #__nuxt, [data-reactroot]';

const IGNORED_IFRAME_URL_PATTERN = new RegExp(RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE, 'i');

const MIN_EMBEDDED_FRAME_DIMENSION_PX = 10;
const MIN_HIDDEN_MAIN_TEXT_CHARS = 300;
const MIN_JSONLD_ARTICLE_BODY_SIGNAL_CHARS = 600;
const MAX_EMPTY_MOUNT_TEXT_CHARS = 40;
const MAX_BUSY_REGION_TEXT_CHARS = 80;
const MAX_SHELL_SIGNAL_TEXT_CHARS = 400;

export interface EmbeddedFrameResourcesResult {
  readonly hasInlineDocument: boolean;
  readonly sameOriginResources: readonly WebPageResource[];
  readonly sameSiteCrossOriginResources: readonly WebPageResource[];
}

export interface DynamicShellSignals {
  readonly hasEmptyMountRoot: boolean;
  readonly hasBusyMainRegion: boolean;
}

export interface DynamicExtractionSignalInput {
  readonly textLength: number;
  readonly scriptCount: number;
  readonly sameOriginFrameCount: number;
  readonly hiddenMainTextLength: number;
  readonly jsonLdArticleBodyLength: number;
  readonly hasEmptyMountRoot: boolean;
  readonly hasBusyMainRegion: boolean;
}

function parseFrameUrl(value: string | null | undefined, baseUrl?: string): URL | undefined {
  if (!value) return undefined;
  try {
    return assertAllowedWebUrl(new URL(value, baseUrl).href);
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return undefined;
    throw error;
  }
}

function hasZeroOrTinyFrameDimension(element: Element): boolean {
  for (const attr of ['width', 'height'] as const) {
    const raw = element.getAttribute(attr)?.trim();
    if (!raw) continue;
    const match = /^(\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(raw);
    if (match && Number(match[1]) <= MIN_EMBEDDED_FRAME_DIMENSION_PX) {
      return true;
    }
  }
  return false;
}

function readFrameLabel(frame: Element): string {
  for (const attr of ['title', 'aria-label', 'name'] as const) {
    const text = normalizeExtractedText(frame.getAttribute(attr)).slice(0, 200);
    if (text) return text;
  }
  return 'Embedded frame document';
}

/**
 * 在主文档被清理前识别主内容区可能承载正文或附件目录的 iframe：
 * - 同源 iframe 进入 `sameOriginResources`，稀疏页时触发升级渲染；
 * - 同站不同源 iframe 仅进入 `sameSiteCrossOriginResources` 作为正式资源交付；
 * - 隐藏元素、像素统计框、导航栏、弹窗和验证码/广告 iframe 全部忽略。
 */
export function extractEmbeddedFrameResources(
  document: Document,
  finalUrl?: string,
): EmbeddedFrameResourcesResult {
  const baseCandidate = document.querySelector('base[href]')?.getAttribute('href');
  const resolvedBase = parseFrameUrl(baseCandidate, finalUrl ?? document.baseURI)?.href
    ?? finalUrl
    ?? document.baseURI;
  const pageUrl = parseFrameUrl(finalUrl ?? resolvedBase);
  if (!pageUrl) {
    return { hasInlineDocument: false, sameOriginResources: [], sameSiteCrossOriginResources: [] };
  }
  const pageDomain = getDomain(pageUrl.hostname, { allowPrivateDomains: true });
  const sameOriginByUrl = new Map<string, WebPageResource>();
  const sameSiteByUrl = new Map<string, WebPageResource>();

  let hasInlineDocument = false;
  for (const frame of document.querySelectorAll('iframe[src], iframe[srcdoc]')) {
    if (frame.closest(FRAME_EXCLUDED_CONTAINER_SELECTOR)) continue;
    if (hasZeroOrTinyFrameDimension(frame) || isExplicitlyHidden(frame)) continue;

    // srcdoc 优先于 src，且不拥有独立资源 URL。只在浏览器能访问子文档时请求内联采集。
    if (frame.hasAttribute('srcdoc')) {
      const sandbox = frame.getAttribute('sandbox');
      if (frame.getAttribute('srcdoc')?.trim() && (sandbox === null || sandbox.split(/\s+/).includes('allow-same-origin'))) {
        hasInlineDocument = true;
      }
      continue;
    }
    const frameUrl = parseFrameUrl(frame.getAttribute('src'), resolvedBase);
    if (!frameUrl || frameUrl.href === pageUrl.href) continue;
    if (IGNORED_IFRAME_URL_PATTERN.test(frameUrl.href)) continue;

    const resource: WebPageResource = {
      kind: 'source',
      url: frameUrl.href,
      label: readFrameLabel(frame),
    };
    if (frameUrl.origin === pageUrl.origin) {
      if (!sameOriginByUrl.has(frameUrl.href)) sameOriginByUrl.set(frameUrl.href, resource);
      continue;
    }
    const frameDomain = getDomain(frameUrl.hostname, { allowPrivateDomains: true });
    if (pageDomain !== null && frameDomain === pageDomain && !sameSiteByUrl.has(frameUrl.href)) {
      sameSiteByUrl.set(frameUrl.href, resource);
    }
  }

  return {
    hasInlineDocument,
    sameOriginResources: [...sameOriginByUrl.values()],
    sameSiteCrossOriginResources: [...sameSiteByUrl.values()],
  };
}

/**
 * 识别尚未水合完毕的前端挂载空壳或主区 `aria-busy="true"` 占位。
 * 只读结构信号，不触发域名特判或读取隐藏文字。
 */
export function inspectDynamicShellSignals(document: Document): DynamicShellSignals {
  let hasEmptyMountRoot = false;
  for (const mount of document.querySelectorAll(EMPTY_MOUNT_SELECTOR)) {
    if (mount.closest(SHELL_CHROME_SELECTOR)) continue;
    if (normalizeExtractedText(mount.textContent).length <= MAX_EMPTY_MOUNT_TEXT_CHARS) {
      hasEmptyMountRoot = true;
      break;
    }
  }

  let hasBusyMainRegion = false;
  const hasMainRegion = document.querySelector(MAIN_REGION_SELECTOR) !== null;
  for (const busy of document.querySelectorAll('[aria-busy="true"]')) {
    if (busy.closest(SHELL_CHROME_SELECTOR)) continue;
    const insideMain = busy.closest(MAIN_REGION_SELECTOR) !== null;
    if (!insideMain && hasMainRegion) continue;
    if (normalizeExtractedText(busy.textContent).length <= MAX_BUSY_REGION_TEXT_CHARS) {
      hasBusyMainRegion = true;
      break;
    }
  }

  return { hasEmptyMountRoot, hasBusyMainRegion };
}

/**
 * 统一汇总阶段 1B 的动态页面启发式 warning。
 * 所有条件只在静态正文明显不足时生效，避免已完整取得正文的静态页误升级。
 */
export function evaluateDynamicExtractionWarnings(
  input: DynamicExtractionSignalInput,
): readonly WebDocumentWarning[] {
  const warnings: WebDocumentWarning[] = [];
  if (
    input.sameOriginFrameCount > 0
    && input.textLength < WEB_READ_SUBSTANTIAL_CONTENT_CHARS
  ) {
    warnings.push('embedded_same_origin_iframe');
  }
  if (
    input.hiddenMainTextLength >= MIN_HIDDEN_MAIN_TEXT_CHARS
    && input.textLength < WEB_READ_SUBSTANTIAL_CONTENT_CHARS
    && input.hiddenMainTextLength >= Math.max(input.textLength * 2, input.textLength + 250)
  ) {
    warnings.push('hidden_main_content');
  }
  const jsonLdMuchLongerThanVisible =
    input.jsonLdArticleBodyLength >= MIN_JSONLD_ARTICLE_BODY_SIGNAL_CHARS
    && input.textLength < WEB_READ_SUBSTANTIAL_CONTENT_CHARS
    && input.jsonLdArticleBodyLength >= Math.max(input.textLength * 3, input.textLength + 400);
  const sparseDynamicShell =
    input.textLength < MAX_SHELL_SIGNAL_TEXT_CHARS
    && input.scriptCount >= 3
    && (input.hasEmptyMountRoot || input.hasBusyMainRegion);
  if (jsonLdMuchLongerThanVisible || sparseDynamicShell) {
    warnings.push('dynamic_content_pending');
  }
  return warnings;
}
