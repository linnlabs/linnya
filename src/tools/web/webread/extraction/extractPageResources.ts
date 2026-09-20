import { assertAllowedWebUrl, WebUrlPolicyError } from '../../shared/urlPolicy';
import type { WebPageResource, WebPageResourceKind } from '../../definitions/webDocument';

const MAX_PAGE_RESOURCES = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLabel(value: string | null | undefined): string | undefined {
  const label = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return label || undefined;
}

function resolveUrl(value: string | null | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined;
  try {
    return assertAllowedWebUrl(new URL(value, baseUrl).href).href;
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return undefined;
    throw error;
  }
}

function resolveDoi(value: string | null | undefined): string | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  return resolveUrl(/^https?:\/\//i.test(raw) ? raw : `https://doi.org/${raw}`);
}

function inferResourceKind(url: string, label: string, hint: string): WebPageResourceKind | undefined {
  const haystack = `${label} ${hint}`.toLowerCase();
  if (/(?:^|[/:])doi\.org\//.test(url.toLowerCase()) || /\bdoi\b/.test(haystack)) return 'doi';
  if (/\.(?:pdf|docx?|xlsx?|pptx?)(?:$|[?#])/.test(url.toLowerCase())
    || /\b(?:download|full\s*text|view\s+(?:the\s+)?(?:report|document)|technical\s+report)\b/.test(haystack)) {
    return 'document';
  }
  if (/\b(?:source|original|official|repository|preprint)\b/.test(haystack)
    || /\b(?:arxiv|escholarship|zenodo|ssrn)\b/.test(`${url} ${haystack}`.toLowerCase())) return 'source';
  return undefined;
}

function addResource(
  resources: Map<string, WebPageResource>,
  url: string | undefined,
  kind: WebPageResourceKind | undefined,
  label?: string,
): void {
  if (!url || !kind || resources.has(url)) return;
  resources.set(url, { kind, url, ...(label ? { label } : {}) });
}

function collectJsonLdRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdRecords);
  if (!isRecord(value)) return [];
  const record = value;
  const graph = record['@graph'];
  return [record, ...(Array.isArray(graph) ? graph.flatMap(collectJsonLdRecords) : [])];
}

function addJsonLdResources(
  document: Document,
  base: string | undefined,
  resources: Map<string, WebPageResource>,
): void {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const records = collectJsonLdRecords(JSON.parse(script.textContent ?? ''));
      for (const record of records) {
        const identifier = typeof record['identifier'] === 'string' ? record['identifier'].trim() : '';
        if (/^10\.\d{4,9}\/\S+$/i.test(identifier)) {
          addResource(resources, resolveDoi(identifier), 'doi', identifier);
        }
        for (const [field, kind] of [
          ['contentUrl', 'document'],
          ['sameAs', 'source'],
        ] as const) {
          const directValues = Array.isArray(record[field]) ? record[field] : [record[field]];
          const encoding = record['encoding'];
          const encodingValues = field === 'contentUrl' && isRecord(encoding)
            ? [encoding['contentUrl']]
            : [];
          const values = [...directValues, ...encodingValues];
          for (const value of values) {
            if (typeof value !== 'string') continue;
            addResource(resources, resolveUrl(value, base), kind, value.trim() || undefined);
          }
        }
      }
    } catch {
      // JSON-LD 是可选 metadata；坏脚本不能阻断正文或其他资源提取。
    }
  }
}

/**
 * Landing page 的摘要和正式资源经常位于 Readability 选中的正文之外。
 * 在正文清理前保存少量、有语义信号的 DOI、全文和来源链接；不把所有导航链接
 * 暴露给 Agent，也不访问这些链接。
 */
export function extractPageResources(document: Document, finalUrl?: string): WebPageResource[] {
  const resources = new Map<string, WebPageResource>();
  const base = finalUrl ?? document.baseURI;

  addJsonLdResources(document, base, resources);

  for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    if (!/(?:citation_pdf_url|citation_doi)/.test(name)) continue;
    const url = name.includes('doi')
      ? resolveDoi(meta.getAttribute('content'))
      : resolveUrl(meta.getAttribute('content'), base);
    const kind: WebPageResourceKind = name.includes('doi') ? 'doi' : 'document';
    addResource(resources, url, kind, normalizeLabel(meta.getAttribute('content')));
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = resolveUrl(anchor.getAttribute('href'), base);
    const label = normalizeLabel(anchor.textContent) ?? normalizeLabel(anchor.getAttribute('title')) ?? '';
    const hint = [anchor.getAttribute('class'), anchor.getAttribute('id'), anchor.getAttribute('rel')]
      .filter(Boolean).join(' ');
    addResource(resources, url, inferResourceKind(url ?? '', label, hint), label);
    if (resources.size >= MAX_PAGE_RESOURCES) break;
  }

  return [...resources.values()].slice(0, MAX_PAGE_RESOURCES);
}
