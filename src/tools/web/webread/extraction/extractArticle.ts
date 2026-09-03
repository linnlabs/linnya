import { Readability } from '@mozilla/readability';
import type { WebDocumentWarning, WebPageAccessBarrier } from '../../definitions/webDocument';
import { WebFailureError } from '../../shared/webFailure';
import { extractSemanticDom, normalizeExtractedText } from './extractSemanticDom';
import { parseCanonicalHtmlDocument } from './parseCanonicalHtmlDocument';

export type ArticleExtractionWarning = WebDocumentWarning;

export interface ExtractArticleResult {
  extractor: 'readability' | 'semantic_dom';
  title: string;
  text: string;
  byline?: string;
  publishedAt?: string;
  siteName?: string;
  language?: string;
  excerpt?: string;
  qualityScore: number;
  warnings: ArticleExtractionWarning[];
  textToHtmlRatio: number;
  rawHtmlLength: number;
  accessBarrier?: WebPageAccessBarrier;
}

interface StructuredMetadata {
  title?: string;
  byline?: string;
  publishedAt?: string;
  siteName?: string;
}

interface PageMetadataSnapshot {
  title?: string;
  byline?: string;
  publishedAt?: string;
  siteName?: string;
  language?: string;
  excerpt?: string;
}

type ReadabilityResult = ReturnType<Readability['parse']>;

export interface ExtractArticleDependencies {
  /** 测试可替换第三方抽取器；生产默认仍只调用 Mozilla Readability 一次。 */
  readonly parseReadability?: (document: Document) => ReadabilityResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNamedValue(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = readNamedValue(item);
      if (name) return name;
    }
    return undefined;
  }
  return isRecord(value) ? readString(value['name']) : undefined;
}

function collectJsonLdRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdRecords);
  if (!isRecord(value)) return [];
  const graph = value['@graph'];
  return [value, ...(Array.isArray(graph) ? graph.flatMap(collectJsonLdRecords) : [])];
}

function readJsonLdMetadata(document: Document): StructuredMetadata {
  const records: Record<string, unknown>[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const source = script.textContent?.trim();
    if (!source) continue;
    try {
      const parsed: unknown = JSON.parse(source);
      records.push(...collectJsonLdRecords(parsed));
    } catch {
      // JSON-LD 是可选元数据；页面中的单个坏脚本不能阻断正文抽取。
    }
  }

  for (const record of records) {
    const title = readString(record['headline']) ?? readString(record['name']);
    const publishedAt = readString(record['datePublished']);
    const byline = readNamedValue(record['author']);
    const siteName = readNamedValue(record['publisher']);
    if (title || publishedAt || byline || siteName) {
      return {
        ...(title ? { title } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(byline ? { byline } : {}),
        ...(siteName ? { siteName } : {}),
      };
    }
  }
  return {};
}

function readMeta(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
    if (content) return content;
  }
  return undefined;
}

function readPageMetadata(document: Document): PageMetadataSnapshot {
  const title = readMeta(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
    || normalizeExtractedText(document.title)
    // 部分官方文档省略显式 <head>；linkedom 此时不填 document.title，
    // 但原始 title 元素仍存在，必须在 Readability 清理 DOM 前读取。
    || normalizeExtractedText(document.querySelector('title')?.textContent);
  const byline = readMeta(document, ['meta[name="author"]', 'meta[property="article:author"]']);
  const publishedAt = readMeta(document, [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
  ]);
  const siteName = readMeta(document, ['meta[property="og:site_name"]']);
  const language = normalizeExtractedText(document.documentElement.lang)
    || readMeta(document, ['meta[http-equiv="content-language"]']);
  const excerpt = readMeta(document, ['meta[name="description"]', 'meta[property="og:description"]']);
  return {
    ...(title ? { title } : {}),
    ...(byline ? { byline } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(siteName ? { siteName } : {}),
    ...(language ? { language } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

function elementTextLength(elements: NodeListOf<Element>): number {
  let length = 0;
  for (const element of elements) length += normalizeExtractedText(element.textContent).length;
  return length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function detectAccessBarrier(document: Document, bodyTextLength: number): WebPageAccessBarrier | undefined {
  // 常规页面经常嵌入不可见验证或登录组件；只在正文稀疏时把明确 DOM 标记视为访问屏障。
  if (bodyTextLength >= 500) return undefined;
  const captchaMarker = document.querySelector(
    '[id*="captcha"], [class*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]',
  );
  if (captchaMarker) return 'captcha';
  return document.querySelector('input[type="password"]') ? 'login_required' : undefined;
}

export function extractArticle(
  html: string,
  dependencies: ExtractArticleDependencies = {},
): ExtractArticleResult {
  // parse5 只负责按浏览器语义规范化 tag soup；随后仍使用轻量 linkedom DOM，
  // 不执行页面脚本，也不引入 jsdom 的网络/XHR 运行时。
  const document = parseCanonicalHtmlDocument(html);
  const jsonLd = readJsonLdMetadata(document);
  const pageMetadata = readPageMetadata(document);
  const bodyTextLength = normalizeExtractedText(document.body?.textContent).length;
  const tableTextLength = elementTextLength(document.querySelectorAll('table'));
  const listTextLength = elementTextLength(document.querySelectorAll('ul, ol'));
  const tableRowCount = document.querySelectorAll('table tr').length;
  const listItemCount = document.querySelectorAll('li').length;
  const scriptCount = document.querySelectorAll('script').length;
  const accessBarrier = detectAccessBarrier(document, bodyTextLength);
  // Readability.parse() 会原地清理 DOM；语义备选必须先读取原始主区域，
  // 否则它只能看到 Readability 已经删减过的节点，无法补回遗漏正文。
  const semantic = extractSemanticDom(document);
  let article: ReadabilityResult;
  try {
    article = dependencies.parseReadability
      ? dependencies.parseReadability(document)
      : new Readability(document, {
          charThreshold: 100,
          disableJSONLD: true,
        }).parse();
  } catch (cause: unknown) {
    // 已有明确语义主区域时，Readability 只是可替换的增强抽取器；它失败不能
    // 推翻已经取得的正文。没有任何正文时才把第三方异常提升为领域失败。
    if (!semantic.text) {
      throw new WebFailureError(
        'extraction_error',
        '[WEB_READ_EXTRACTION_FAILED] 网页正文抽取器执行失败（stage=readability）。',
        {
          details: { extractionStage: 'readability' },
          cause,
        },
      );
    }
    article = null;
  }
  const readabilityText = normalizeExtractedText(article?.textContent);
  const useSemanticDom = semantic.text.length > readabilityText.length
    && (readabilityText.length < 200
      || (semantic.text.length - readabilityText.length >= 300
        && semantic.text.length >= readabilityText.length * 1.35));
  const extractor = useSemanticDom ? 'semantic_dom' : 'readability';
  const text = useSemanticDom ? semantic.text : readabilityText;
  const textToHtmlRatio = text.length / Math.max(1, html.length);
  const warnings = new Set<ArticleExtractionWarning>();

  if (!article) warnings.add('readability_failed');
  if (!text) warnings.add('empty_content');
  else if (text.length < 200) warnings.add('content_too_short');
  if (html.length >= 1_000 && textToHtmlRatio < 0.02) warnings.add('low_text_ratio');
  if (text.length < 200 && bodyTextLength < 300 && scriptCount >= 3) warnings.add('js_shell');
  if (tableRowCount >= 3 && tableTextLength / Math.max(1, bodyTextLength) >= 0.5) {
    warnings.add('table_dominant');
  }
  if (listItemCount >= 5 && listTextLength / Math.max(1, bodyTextLength) >= 0.6) {
    warnings.add('list_dominant');
  }

  let qualityScore = 1;
  if (warnings.has('readability_failed')) qualityScore -= 0.3;
  if (warnings.has('empty_content')) qualityScore = 0;
  if (warnings.has('content_too_short')) qualityScore -= 0.35;
  if (warnings.has('low_text_ratio')) qualityScore -= 0.25;
  if (warnings.has('js_shell')) qualityScore -= 0.4;
  if (warnings.has('table_dominant')) qualityScore -= 0.15;
  if (warnings.has('list_dominant')) qualityScore -= 0.15;

  const title = (useSemanticDom ? semantic.title : normalizeExtractedText(article?.title))
    || jsonLd.title
    || pageMetadata.title
    || semantic.title
    || '';
  const byline = normalizeExtractedText(article?.byline)
    || jsonLd.byline
    || pageMetadata.byline;
  const publishedAt = normalizeExtractedText(article?.publishedTime)
    || jsonLd.publishedAt
    || pageMetadata.publishedAt;
  const siteName = normalizeExtractedText(article?.siteName)
    || jsonLd.siteName
    || pageMetadata.siteName;
  const language = normalizeExtractedText(article?.lang)
    || pageMetadata.language;
  const excerpt = normalizeExtractedText(article?.excerpt)
    || pageMetadata.excerpt;

  return {
    extractor,
    title,
    text,
    qualityScore: clampScore(qualityScore),
    warnings: [...warnings],
    textToHtmlRatio,
    rawHtmlLength: html.length,
    ...(accessBarrier ? { accessBarrier } : {}),
    ...(byline ? { byline } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(siteName ? { siteName } : {}),
    ...(language ? { language } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}
