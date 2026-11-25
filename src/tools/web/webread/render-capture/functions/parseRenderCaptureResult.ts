import { isRecord } from '@linnya/foundation';
import { assertAllowedWebUrl, WebUrlPolicyError } from '../../../shared/urlPolicy';
import {
  BROWSER_CAPTURE_WARNING_VALUES,
  type BrowserCaptureAccessBarrier,
  type BrowserCapturePayload,
  type BrowserCaptureWarning,
  type BrowserCapturedFrameResource,
  type BrowserReadinessSample,
  type BrowserScrollProbe,
} from '../definitions/renderCaptureContract';

const MAX_CAPTURE_WARNINGS = 4;
const MAX_CAPTURE_FRAME_RESOURCES = 16;
const MAX_FRAME_URL_CHARS = 2_048;
const MAX_FRAME_LABEL_CHARS = 200;

const ALLOWED_CAPTURE_WARNINGS = new Set<string>(BROWSER_CAPTURE_WARNING_VALUES);

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBrowserCaptureWarning(value: string): value is BrowserCaptureWarning {
  return ALLOWED_CAPTURE_WARNINGS.has(value);
}

function parseAccessBarrier(value: unknown): BrowserCaptureAccessBarrier | undefined {
  if (value === undefined) return undefined;
  if (value === 'login_required' || value === 'captcha') return value;
  return undefined;
}

function parseFrameResource(value: unknown): BrowserCapturedFrameResource | null {
  if (!isRecord(value)) return null;
  const kind = value['kind'];
  const rawUrl = value['url'];
  if (kind !== undefined && kind !== 'source') return null;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_FRAME_URL_CHARS) {
    return null;
  }
  let normalizedUrl: string;
  try {
    normalizedUrl = assertAllowedWebUrl(rawUrl).href;
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return null;
    throw error;
  }
  const rawLabel = value['label'];
  const label = typeof rawLabel === 'string'
    ? rawLabel.replace(/\s+/g, ' ').trim().slice(0, MAX_FRAME_LABEL_CHARS)
    : '';
  return {
    kind: 'source',
    url: normalizedUrl,
    ...(label ? { label } : {}),
  };
}

/** 校验浏览器就绪采样；兼容未提供 mainTextLength 的轻量伪对象（回落到 textLength）。 */
export function parseBrowserReadinessSample(value: unknown): BrowserReadinessSample | null {
  if (!isRecord(value)) return null;
  const readyState = value['readyState'];
  const textLength = value['textLength'];
  const rawMainTextLength = value['mainTextLength'];
  const scriptCount = value['scriptCount'];
  if (typeof readyState !== 'string' || !isNonNegativeFiniteNumber(textLength)) return null;
  const mainTextLength = isNonNegativeFiniteNumber(rawMainTextLength)
    ? rawMainTextLength
    : textLength;
  return {
    readyState,
    textLength,
    mainTextLength,
    scriptCount: isNonNegativeFiniteNumber(scriptCount) ? scriptCount : 0,
  };
}

/** 校验受控滚动探针返回值。 */
export function parseBrowserScrollProbe(value: unknown): BrowserScrollProbe | null {
  if (!isRecord(value)) return null;
  const scrollY = value['scrollY'];
  const scrollHeight = value['scrollHeight'];
  const viewportHeight = value['viewportHeight'];
  const mainTextLength = value['mainTextLength'];
  const atBottom = value['atBottom'];
  if (
    !isNonNegativeFiniteNumber(scrollY)
    || !isNonNegativeFiniteNumber(scrollHeight)
    || !isNonNegativeFiniteNumber(viewportHeight)
    || !isNonNegativeFiniteNumber(mainTextLength)
    || typeof atBottom !== 'boolean'
  ) {
    return null;
  }
  return { scrollY, scrollHeight, viewportHeight, mainTextLength, atBottom };
}

/**
 * 严格校验浏览器内 DOM 采集脚本输出。
 * 任一必需字段非法则返回 null，由调用方安全回退 `outerHTML`。
 */
export function parseBrowserCapturePayload(value: unknown): BrowserCapturePayload | null {
  if (!isRecord(value)) return null;
  const html = value['html'];
  if (typeof html !== 'string') return null;

  const rawBarrier = value['accessBarrier'];
  if (rawBarrier !== undefined && rawBarrier !== 'login_required' && rawBarrier !== 'captcha') {
    return null;
  }
  const accessBarrier = parseAccessBarrier(rawBarrier);

  const rawWarnings = value['warnings'];
  if (rawWarnings !== undefined && !Array.isArray(rawWarnings)) return null;
  const warnings: BrowserCaptureWarning[] = [];
  if (rawWarnings) {
    for (const item of rawWarnings) {
      if (typeof item !== 'string' || !isBrowserCaptureWarning(item)) continue;
      if (!warnings.includes(item)) warnings.push(item);
      if (warnings.length >= MAX_CAPTURE_WARNINGS) break;
    }
  }

  const rawResources = value['inlinedFrameResources'];
  if (rawResources !== undefined && !Array.isArray(rawResources)) return null;
  const inlinedFrameResources: BrowserCapturedFrameResource[] = [];
  const seenUrls = new Set<string>();
  if (rawResources) {
    for (const item of rawResources) {
      const resource = parseFrameResource(item);
      if (!resource || seenUrls.has(resource.url)) continue;
      seenUrls.add(resource.url);
      inlinedFrameResources.push(resource);
      if (inlinedFrameResources.length >= MAX_CAPTURE_FRAME_RESOURCES) break;
    }
  }

  const rawMainTextLength = value['mainTextLength'];
  if (rawMainTextLength !== undefined && !isNonNegativeFiniteNumber(rawMainTextLength)) {
    return null;
  }

  return {
    html,
    ...(accessBarrier ? { accessBarrier } : {}),
    warnings,
    inlinedFrameResources,
    mainTextLength: isNonNegativeFiniteNumber(rawMainTextLength) ? rawMainTextLength : 0,
  };
}
