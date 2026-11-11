import { WEB_PAGE_IMAGES_MAX, type WebPageImage } from '@app/schemas';
import { assertAllowedWebUrl, WebUrlPolicyError } from '../../shared/urlPolicy';
import { normalizeUrl } from '../../websearch/citations/normalizeUrl';

/**
 * 网页上的主要图片：分享图（og:image）、带图注的 figure，以及正文区里有尺寸依据的大图。
 * 只列地址与原文的图注、署名，不下载、不判断许可；导航、页眉页脚、侧栏和图标类小图不列。
 * 页面版权声明取页脚或版权块里的一句原文，供判断能否引用。
 */

/** 正文图至少这么大才列；没有尺寸属性的正文图只在 figure 里才列。 */
const MIN_CONTENT_EDGE = 300;
const MIN_SRCSET_WIDTH = 600;
const SKIP_HINT = /(?:^|[\s_-])(?:logo|icon|avatar|sprite|badge|emoji|placeholder|spinner|loading|pixel|tracking|qrcode|qr-code|share|social|banner-ad|advert)(?:$|[\s_.-])/i;
const UNSUPPORTED_PATH = /\.(?:svg|svgz|gif|ico)(?:$|[?#])/i;
const CREDIT_HINT = /credit|copyright|photographer|attribution|source|byline|courtesy|rights/i;
const CREDIT_TEXT = /©|\(c\)|\bphoto(?:graph)?\s*(?:by|:)|\bcredit\s*:|\bcourtesy\b|\bimage\s*(?:by|:)|图片来源|图源|摄影|供图|来源[:：]|写真[:：]|提供[:：]/i;
const RIGHTS_TEXT = /©|copyright|all rights reserved|版权所有|著作权|保留所有权利|無斷転載|저작권/i;
const EXCLUDED_ANCESTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

/** 只有文件名或一串编号的 alt/图注不算说明文字。 */
const FILENAME_LIKE = /^[\w-]+\.(?:jpe?g|png|webp|gif|avif)$|^[0-9a-f-]{16,}$/i;

function clean(value: string | null | undefined, maxChars: number): string | undefined {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || FILENAME_LIKE.test(text)) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

function resolveUrl(value: string | null | undefined, base: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return undefined;
  try {
    const url = normalizeUrl(assertAllowedWebUrl(new URL(raw, base).href).href);
    return UNSUPPORTED_PATH.test(new URL(url).pathname) ? undefined : url;
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return undefined;
    throw error;
  }
}

/** srcset 里取最大的一张（按 w 描述符；只有 x 描述符时取最大倍率）。 */
function largestFromSrcset(srcset: string | null): { url: string; width?: number } | undefined {
  if (!srcset) return undefined;
  let best: { url: string; score: number; width?: number } | undefined;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor = '1x'] = part.trim().split(/\s+/);
    if (!url) continue;
    const width = /^(\d+)w$/.exec(descriptor);
    const density = /^([\d.]+)x$/.exec(descriptor);
    const score = width ? Number(width[1]) : density ? Number(density[1]) * 1000 : 0;
    if (!best || score > best.score) best = { url, score, ...(width ? { width: Number(width[1]) } : {}) };
  }
  return best ? { url: best.url, ...(best.width ? { width: best.width } : {}) } : undefined;
}

function readDimension(element: Element, name: 'width' | 'height'): number | undefined {
  const value = Number.parseInt(element.getAttribute(name) ?? element.getAttribute(`data-${name}`) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 懒加载属性优先于 src（src 常是占位图）；srcset 取最大的一张。 */
function imageSource(img: Element, base: string | undefined): { url: string; srcsetWidth?: number } | undefined {
  const srcset = largestFromSrcset(img.getAttribute('data-srcset') ?? img.getAttribute('srcset'));
  const candidates = [
    img.getAttribute('data-src'), img.getAttribute('data-original'), img.getAttribute('data-lazy-src'),
    img.getAttribute('data-full-src'), srcset?.url, img.getAttribute('src'),
  ];
  for (const candidate of candidates) {
    const url = resolveUrl(candidate, base);
    if (url) return { url, ...(srcset?.width && candidate === srcset.url ? { srcsetWidth: srcset.width } : {}) };
  }
  return undefined;
}

function skipped(img: Element): boolean {
  const hint = [img.getAttribute('class'), img.getAttribute('id'), img.getAttribute('alt'), img.getAttribute('src')]
    .filter(Boolean).join(' ');
  return SKIP_HINT.test(hint) || img.closest(EXCLUDED_ANCESTORS) !== null;
}

function findCredit(scope: Element, caption: string | undefined): string | undefined {
  for (const element of scope.querySelectorAll('[class], [itemprop]')) {
    const hint = `${element.getAttribute('class') ?? ''} ${element.getAttribute('itemprop') ?? ''}`;
    if (CREDIT_HINT.test(hint)) {
      const text = clean(element.textContent, 300);
      if (text) return text;
    }
  }
  if (caption && CREDIT_TEXT.test(caption)) {
    const match = caption.split(/(?<=[.。])\s+|\s+[|｜]\s+/).find(part => CREDIT_TEXT.test(part));
    return clean(match, 300);
  }
  return undefined;
}

export function extractPageImages(document: Document, finalUrl?: string): { images: WebPageImage[]; pageRights?: string } {
  const base = resolveUrl(document.querySelector('base[href]')?.getAttribute('href'), finalUrl) ?? finalUrl;
  const images = new Map<string, WebPageImage>();
  // 同一张图常以不同尺寸、裁切参数出现多次（缩略图与分享图）；路径带图片扩展名时按路径去重。
  const identity = (url: string): string => {
    const parsed = new URL(url);
    return /\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname) ? `${parsed.origin}${parsed.pathname}` : url;
  };
  const add = (image: WebPageImage): void => {
    const key = identity(image.url);
    if (images.size < WEB_PAGE_IMAGES_MAX && !images.has(key)) images.set(key, image);
  };

  for (const figure of document.querySelectorAll('figure')) {
    const img = figure.querySelector('img');
    if (!img || skipped(img)) continue;
    const source = imageSource(img, base);
    if (!source) continue;
    const caption = clean(figure.querySelector('figcaption')?.textContent, 500);
    const credit = findCredit(figure, caption);
    const width = readDimension(img, 'width') ?? source.srcsetWidth;
    const height = readDimension(img, 'height');
    if (width !== undefined && width < MIN_CONTENT_EDGE / 2) continue;
    const alt = clean(img.getAttribute('alt'), 300);
    add({
      url: source.url, kind: 'figure',
      ...(alt ? { alt } : {}), ...(caption ? { caption } : {}), ...(credit ? { credit } : {}),
      ...(width ? { width } : {}), ...(height ? { height } : {}),
    });
  }

  const main = document.querySelector('article, main, [role="main"]') ?? document.body;
  for (const img of main?.querySelectorAll('img') ?? []) {
    if (img.closest('figure') || skipped(img)) continue;
    const source = imageSource(img, base);
    if (!source) continue;
    const width = readDimension(img, 'width');
    const height = readDimension(img, 'height');
    const largeByAttributes = width !== undefined && height !== undefined && Math.min(width, height) >= MIN_CONTENT_EDGE;
    const largeBySrcset = (source.srcsetWidth ?? 0) >= MIN_SRCSET_WIDTH;
    if (!largeByAttributes && !largeBySrcset) continue;
    const alt = clean(img.getAttribute('alt') ?? img.getAttribute('title'), 300);
    // 只在只包着这一张图的小容器里找署名，正文大容器里的署名可能属于别的图。
    const wrapper = img.parentElement;
    const credit = wrapper && wrapper.querySelectorAll('img').length === 1
      && !wrapper.matches('article, main, [role="main"], body, section')
      ? findCredit(wrapper, undefined) : undefined;
    add({
      url: source.url, kind: 'content',
      ...(alt ? { alt } : {}), ...(credit ? { credit } : {}),
      ...(width ? { width } : source.srcsetWidth ? { width: source.srcsetWidth } : {}), ...(height ? { height } : {}),
    });
  }

  const ogImage = resolveUrl(
    document.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"], meta[name="twitter:image"]')?.getAttribute('content'),
    base,
  );
  if (ogImage) {
    const alt = clean(document.querySelector('meta[property="og:image:alt"], meta[name="twitter:image:alt"]')?.getAttribute('content'), 300);
    const width = Number.parseInt(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content') ?? '', 10);
    const height = Number.parseInt(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content') ?? '', 10);
    add({
      url: ogImage, kind: 'og', ...(alt ? { alt } : {}),
      ...(width > 0 ? { width } : {}), ...(height > 0 ? { height } : {}),
    });
  }

  // 页脚里取含版权字样的最小元素的原文，避免把联系方式、导航一起带上。
  let pageRights: string | undefined;
  for (const container of document.querySelectorAll('footer, [role="contentinfo"], [class*="copyright"], [id*="copyright"], [class*="footer"]')) {
    let best: string | undefined;
    for (const element of [container, ...container.querySelectorAll('*')]) {
      const text = clean(element.textContent, 2_000);
      if (text && RIGHTS_TEXT.test(text) && (!best || text.length < best.length)) best = text;
    }
    pageRights = clean(best, 300);
    if (pageRights) break;
  }

  return { images: [...images.values()], ...(pageRights ? { pageRights } : {}) };
}
