import { load } from 'cheerio';
import type { ImageSearchCandidate } from '@app/schemas';
import type { CommonsImageItem } from '../../../../infra/adapters/image-search/commonsImageSearchAdapter';
import type { OpenverseImageItem } from '../../../../infra/adapters/image-search/openverseImageSearchAdapter';
import { assertAllowedWebUrl, WebUrlPolicyError } from '../../shared/urlPolicy';
import { normalizeUrl } from '../../websearch/citations/normalizeUrl';
import { buildImageAttribution, normalizeImageLicense } from './normalizeImageLicense';

export type ImageCandidateDraft = Omit<ImageSearchCandidate, 'id'>;

/** web_read 能检查并保存的位图格式；其余（GIF、SVG、TIFF 原件）只在来源给出位图缩放版时可用。 */
const DOWNLOADABLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UNSUPPORTED_EXTENSION = /\.(?:gif|svg|svgz|tiff?|bmp|ico|heic|avif)(?:$|[?#])/i;

/** 元数据里的 HTML 片段只取可见文字，压成一行。 */
export function cleanMetadataText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  const text = load(`<div>${value}</div>`)('div').first().text()
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeUrl(assertAllowedWebUrl(value.startsWith('//') ? `https:${value}` : value).href);
  } catch (error) {
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return undefined;
    throw error;
  }
}

/** Commons 缩略图按标准档位生成；把下载用的 1920 档换成 330 档给界面预览。不是缩略图地址时不给。 */
const COMMONS_PREVIEW_WIDTH = 330;
function commonsThumbnail(thumbUrl: string | undefined, thumbWidth: number | undefined): string | undefined {
  if (!thumbUrl || !thumbWidth || !thumbUrl.includes('/thumb/')) return undefined;
  if (thumbWidth <= COMMONS_PREVIEW_WIDTH) return thumbUrl;
  const replaced = thumbUrl.replace(new RegExp(`/((?:lossy|lossless)-page\\d+-)?${thumbWidth}px-([^/]+)$`), `/$1${COMMONS_PREVIEW_WIDTH}px-$2`);
  return replaced === thumbUrl ? undefined : replaced;
}

/** Openverse 为每张图提供缩略图接口。 */
function openverseThumbnail(id: string): string | undefined {
  return /^[0-9a-f-]{36}$/i.test(id) ? `https://api.openverse.org/v1/images/${id}/thumb/` : undefined;
}

function fileTitle(title: string): string {
  return title.replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
}

export function commonsCandidate(item: CommonsImageItem): ImageCandidateDraft | undefined {
  const imageUrl = safeUrl(item.imageUrl);
  const pageUrl = safeUrl(item.pageUrl);
  // 缩略图地址在原图不超过下载宽度时就是原图本身；TIFF 等格式的缩略图是 JPEG。
  const downloadUrl = safeUrl(item.thumbUrl) ?? (item.mime && DOWNLOADABLE_MIME.has(item.mime) ? imageUrl : undefined);
  if (!imageUrl || !pageUrl || !downloadUrl || UNSUPPORTED_EXTENSION.test(new URL(downloadUrl).pathname)) return undefined;
  const meta = item.metadata;
  const title = cleanMetadataText(meta.ObjectName, 300) ?? (fileTitle(item.title) || 'Untitled');
  const creator = cleanMetadataText(meta.Artist, 300) ?? cleanMetadataText(meta.Credit, 300);
  const license = normalizeImageLicense({
    ...(meta.LicenseShortName ? { name: cleanMetadataText(meta.LicenseShortName, 200) } : meta.UsageTerms ? { name: cleanMetadataText(meta.UsageTerms, 200) } : {}),
    ...(meta.LicenseUrl ? { url: meta.LicenseUrl.startsWith('//') ? `https:${meta.LicenseUrl}` : meta.LicenseUrl } : {}),
  });
  if (meta.AttributionRequired === 'false' && license.code === 'other') {
    // 来源声明无需署名的非 CC 条款仍按 other 处理，只修正署名事实。
    Object.assign(license, { attribution_required: false });
  }
  const description = cleanMetadataText(meta.ImageDescription, 500);
  const downloadWidth = downloadUrl === imageUrl ? item.width : item.thumbWidth;
  const thumbnailUrl = safeUrl(commonsThumbnail(item.thumbUrl, item.thumbWidth));
  return {
    source: 'wikimedia_commons',
    provider: 'wikimedia_commons',
    title,
    image_url: imageUrl,
    download_url: downloadUrl,
    page_url: pageUrl,
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
    ...(downloadWidth ? { download_width: downloadWidth } : {}),
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    license,
    attribution: buildImageAttribution({ title, ...(creator ? { creator } : {}), pageUrl, license, via: 'Wikimedia Commons' }),
  };
}

export function openverseCandidate(item: OpenverseImageItem): ImageCandidateDraft | undefined {
  const imageUrl = safeUrl(item.imageUrl);
  const pageUrl = safeUrl(item.pageUrl);
  if (!imageUrl || !pageUrl || UNSUPPORTED_EXTENSION.test(new URL(imageUrl).pathname)) return undefined;
  if (item.filetype && !['jpg', 'jpeg', 'png', 'webp'].includes(item.filetype.toLowerCase())) return undefined;
  const title = cleanMetadataText(item.title, 300) ?? 'Untitled';
  const creator = cleanMetadataText(item.creator, 300);
  const license = normalizeImageLicense({
    code: item.license,
    ...(item.licenseVersion ? { version: item.licenseVersion } : {}),
    ...(item.licenseUrl ? { url: item.licenseUrl } : {}),
  });
  const provider = item.source ?? item.provider ?? 'openverse';
  // 缩略图接口地址由编号拼成，不做规范化：去掉末尾斜杠会多一次 301 跳转。
  const thumbnailUrl = openverseThumbnail(item.id);
  return {
    source: 'openverse',
    provider: provider.slice(0, 100),
    title,
    image_url: imageUrl,
    download_url: imageUrl,
    page_url: pageUrl,
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    ...(item.width ? { width: item.width, download_width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
    ...(creator ? { creator } : {}),
    license,
    attribution: cleanMetadataText(item.attribution, 600)
      ?? buildImageAttribution({ title, ...(creator ? { creator } : {}), pageUrl, license, via: provider }),
  };
}
