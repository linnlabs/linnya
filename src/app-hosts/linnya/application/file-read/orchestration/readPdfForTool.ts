/**
 * read_file 的 PDF 分支：按页返回文字层、在页内查找、或把单页渲染成图片交给看得见图的模型。
 *
 * 文字来自 PDF.js 文字层与知识库共用的版面分析，不调用任何模型；扫描页只报告“没有文字层”，
 * 是否看图由 Agent 用 view="page_image" 决定。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  WORKSPACE_READ_FILE_PDF_FIND_MAX_PAGES,
  WORKSPACE_READ_FILE_PDF_MAX_PAGES,
  WorkspaceReadFileResultSchema,
  parsePdfPageRange,
} from '@app/schemas';
import type { ManagedImageContentIngressPort } from 'src/domains/assets/features/managed-image-ingress';
import type { ToolResultAssetClaimRegistryPort } from 'src/domains/assets/features/tool-result-claims';
import { openPdfPageReader, type PdfPageReader, type PdfPageText } from 'src/features/parsers/pdfParser';
import { PhysicalFileReadError, type PhysicalPdfFileReadResult } from '../definitions/physicalFileRead';
import { findInPageText } from '../functions/findInPageText';
import { PdfPageTextCache, SerialGate } from '../functions/pdfPageTextCache';

/**
 * 一次返回的页文字在页边界停下的预算（UTF-16 字符与行数）。Host 的工具输出预览为 20,000 字符 / 1,200 行，
 * 超出会截成前缀，末尾的下一段页码提示随之丢失；这里留出页头、布局说明和续读提示的空间。
 * 第一页总会返回；单页本身超长时才交给 ToolOutputStore 续读。
 */
const WINDOW_CHARS = 15_000;
const WINDOW_LINES = 900;
const MAX_FIND_CONTEXTS = 30;

const defaultCache = new PdfPageTextCache();
const defaultGate = new SerialGate();

export type PdfReadRequest =
  | { readonly view: 'text'; readonly pages?: string; readonly find?: string }
  | { readonly view: 'page_image'; readonly pages: string };

export interface PdfReadInput {
  readonly source: PhysicalPdfFileReadResult & { readonly locator: string };
  readonly sourceKind: 'conversation_file' | 'host_file';
  readonly request: PdfReadRequest;
  readonly hasExplicitLineWindow: boolean;
  readonly imageIngress: ManagedImageContentIngressPort;
  readonly claims: ToolResultAssetClaimRegistryPort;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly imageDelivery: 'attach' | 'metadata_only';
  readonly hasAttachedImageContent: (sha256: string) => boolean;
  readonly signal?: AbortSignal;
  readonly cache?: PdfPageTextCache;
  readonly gate?: SerialGate;
}

interface PdfSession {
  readonly pageCount: number;
  text(pageNumber: number): Promise<PdfPageText>;
  render(pageNumber: number): ReturnType<PdfPageReader['renderPageToJpeg']>;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  throw error;
}

async function withPdfSession<T>(input: PdfReadInput, task: (session: PdfSession) => Promise<T>): Promise<T> {
  const cache = input.cache ?? defaultCache;
  return (input.gate ?? defaultGate).run(async () => {
    throwIfAborted(input.signal);
    const key = PdfPageTextCache.key(input.source);
    let reader: PdfPageReader | undefined;
    const open = async (): Promise<PdfPageReader> => {
      if (reader) return reader;
      const bytes = await readFile(input.source.resolvedPath);
      try {
        reader = await openPdfPageReader(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new PhysicalFileReadError(
          'READ_FILE_PDF_UNREADABLE',
          `PDF 无法打开（可能已加密或损坏）：${reason.slice(0, 200)}`,
        );
      }
      return reader;
    };
    try {
      const pageCount = cache.pageCount(key) ?? (await open()).pageCount;
      return await task({
        pageCount,
        async text(pageNumber) {
          const cached = cache.get(key, pageNumber);
          if (cached) return cached;
          const page = await (await open()).readPageText(pageNumber);
          cache.put(key, pageCount, page);
          return page;
        },
        async render(pageNumber) {
          return (await open()).renderPageToJpeg(pageNumber);
        },
      });
    } finally {
      await reader?.close().catch(() => undefined);
    }
  });
}

function requirePageInRange(pageNumber: number, pageCount: number): void {
  if (pageNumber > pageCount) {
    throw new PhysicalFileReadError(
      'READ_FILE_PDF_PAGE_OUT_OF_RANGE',
      `PDF 只有 ${pageCount} 页，没有第 ${pageNumber} 页。`,
      { pageCount },
    );
  }
}

const formatSpan = (from: number, to: number) => (from === to ? String(from) : `${from}-${to}`);
const call = (args: Record<string, string>) => `read_file(${JSON.stringify(args)})`;

/**
 * 无文字层页的去向与读图同一规则：当前模型接收工具结果图片时建议 page_image；不接收时（ToolNode
 * 绑定 admitted=false）明确告知读不到，不指向它看不到的图片，也不调用另配的视觉解析模型。
 */
function describeLayout(pages: readonly PdfPageText[], input: PdfReadInput): string[] {
  const locator = input.source.locator;
  const noText = pages.filter(page => page.layout === 'no_text').map(page => page.pageNumber);
  const complex = pages.filter(page => page.layout === 'complex').map(page => page.pageNumber);
  const noTextHint = input.imageDelivery === 'attach'
    ? `They are scans or images; ${call({ locator, view: 'page_image', pages: String(noText[0]) })} attaches one page as an image.`
    : 'They are scans or images, and the current model connection does not receive images, so their content cannot be read here. Do not guess what they say; state that these pages were not checked.';
  return [
    ...(noText.length ? [`Pages without a text layer: ${noText.join(', ')}. ${noTextHint}`] : []),
    ...(complex.length ? [`Pages with irregular layout (reading order may be off): ${complex.join(', ')}.`] : []),
  ];
}

function pdfData(input: PdfReadInput, session: PdfSession, pages: readonly PdfPageText[]) {
  return {
    source_kind: input.sourceKind,
    locator: input.source.locator,
    file_name: input.source.fileName,
    content_type: 'application/pdf' as const,
    byte_length: input.source.byteLength,
    page_count: session.pageCount,
    pages_without_text: pages.filter(page => page.layout === 'no_text').map(page => page.pageNumber),
    complex_layout_pages: pages.filter(page => page.layout === 'complex').map(page => page.pageNumber),
  };
}

function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 0x0a) count += 1;
  return count;
}

async function readPages(input: PdfReadInput, session: PdfSession, pagesArg: string | undefined): Promise<string> {
  const locator = input.source.locator;
  const requested = pagesArg ? parsePdfPageRange(pagesArg) : undefined;
  const from = requested?.from ?? 1;
  requirePageInRange(from, session.pageCount);
  const lastAllowed = Math.min(requested?.to ?? from + WORKSPACE_READ_FILE_PDF_MAX_PAGES - 1, session.pageCount);
  const pages: PdfPageText[] = [];
  let chars = 0;
  let lines = 0;
  for (let pageNumber = from; pageNumber <= lastAllowed; pageNumber += 1) {
    throwIfAborted(input.signal);
    const page = await session.text(pageNumber);
    const pageLines = countLines(page.text) + 2;
    if (pages.length > 0 && (chars + page.text.length > WINDOW_CHARS || lines + pageLines > WINDOW_LINES)) break;
    pages.push(page);
    chars += page.text.length;
    lines += pageLines;
  }
  const to = pages[pages.length - 1]!.pageNumber;
  const stoppedEarly = to < lastAllowed;
  const hasMore = to < session.pageCount;
  // 预算提前停下时续读本次请求剩余的页；完整返回时按同样页数向后翻。
  const nextPages = hasMore
    ? formatSpan(to + 1, stoppedEarly ? lastAllowed : Math.min(to + pages.length, session.pageCount))
    : undefined;
  const body = pages.map(page => (page.layout === 'no_text'
    ? `[Page ${page.pageNumber}: no text layer]`
    : `[Page ${page.pageNumber}]\n${page.text}`));
  const observation = [
    `PDF ${locator}: ${session.pageCount} pages; returned pages ${formatSpan(from, to)}. Text comes from the PDF text layer; no OCR was run.`,
    ...(requested && requested.to > session.pageCount ? [`Requested pages beyond ${session.pageCount} do not exist.`] : []),
    ...(stoppedEarly ? [`Stopped after page ${to} to keep this result within the output limit; continue with the next pages call below.`] : []),
    ...describeLayout(pages, input),
    '',
    body.join('\n\n'),
    ...(nextPages ? ['', `[read_file: next pages: ${call({ locator, pages: nextPages })}]`] : []),
  ].join('\n');
  return JSON.stringify(WorkspaceReadFileResultSchema.parse({
    data: {
      ...pdfData(input, session, pages),
      mode: 'pages',
      pages: { from, to },
      has_more: hasMore,
      ...(nextPages ? { next_pages: nextPages } : {}),
    },
    observation,
  }), null, 2);
}

async function findPages(input: PdfReadInput, session: PdfSession, query: string, pagesArg: string | undefined): Promise<string> {
  const locator = input.source.locator;
  const requested = pagesArg ? parsePdfPageRange(pagesArg) : undefined;
  const from = requested?.from ?? 1;
  requirePageInRange(from, session.pageCount);
  const scopeEnd = Math.min(requested?.to ?? session.pageCount, session.pageCount);
  const to = Math.min(scopeEnd, from + WORKSPACE_READ_FILE_PDF_FIND_MAX_PAGES - 1);
  const pages: PdfPageText[] = [];
  const contexts: string[] = [];
  const hitPages: number[] = [];
  let hitCount = 0;
  for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
    throwIfAborted(input.signal);
    const page = await session.text(pageNumber);
    pages.push(page);
    const found = findInPageText(page.text, query, MAX_FIND_CONTEXTS - contexts.length);
    if (found.count === 0) continue;
    hitCount += found.count;
    hitPages.push(pageNumber);
    contexts.push(...found.matches.map(match => `[Page ${pageNumber}] ${match.context}`));
  }
  const hasMore = to < scopeEnd;
  const nextPages = hasMore ? formatSpan(to + 1, Math.min(to + WORKSPACE_READ_FILE_PDF_FIND_MAX_PAGES, scopeEnd)) : undefined;
  const truncated = contexts.length < hitCount;
  const observation = [
    `PDF ${locator}: ${session.pageCount} pages. Searched pages ${formatSpan(from, to)} for ${JSON.stringify(query)}, ignoring full/half width, case and whitespace: ${hitCount} ${hitCount === 1 ? 'match' : 'matches'}${hitPages.length ? ` on pages ${hitPages.join(', ')}` : ''}.`,
    ...describeLayout(pages, input).map(line => (line.startsWith('Pages without') ? `${line} Text on those pages was not searched.` : line)),
    ...(contexts.length ? ['', ...contexts] : []),
    ...(truncated ? ['', `Only the first ${contexts.length} matches are shown.`] : []),
    ...(hitPages.length ? ['', `Read a whole page with ${call({ locator, pages: String(hitPages[0]) })}.`] : []),
    ...(nextPages ? ['', `[read_file: search continues: ${call({ locator, find: query, pages: nextPages })}]`] : []),
  ].join('\n');
  return JSON.stringify(WorkspaceReadFileResultSchema.parse({
    data: {
      ...pdfData(input, session, pages),
      mode: 'find',
      pages: { from, to },
      has_more: hasMore,
      ...(nextPages ? { next_pages: nextPages } : {}),
      find: { query, hit_count: hitCount, hit_pages: hitPages, truncated },
    },
    observation,
  }), null, 2);
}

async function renderPage(input: PdfReadInput, session: PdfSession, pageNumber: number): Promise<string> {
  requirePageInRange(pageNumber, session.pageCount);
  throwIfAborted(input.signal);
  const rendered = await session.render(pageNumber);
  const base = {
    source_kind: input.sourceKind,
    locator: input.source.locator,
    file_name: input.source.fileName,
    content_type: 'image/jpeg' as const,
    byte_length: rendered.jpegBytes.length,
    width: rendered.width,
    height: rendered.height,
    pdf_page_number: pageNumber,
  };
  const label = `PDF 第 ${pageNumber} 页（共 ${session.pageCount} 页）已渲染为 ${rendered.width}×${rendered.height} 图片`;
  if (input.imageDelivery === 'metadata_only') {
    return JSON.stringify(WorkspaceReadFileResultSchema.parse({
      data: { ...base, attachment_status: 'not_delivered' },
      observation: `${label}；当前模型连接不接收工具结果图片，你没有看到像素。不要声称已看过这页，需要时说明未检查。`,
    }), null, 2);
  }
  const asset = await input.imageIngress.ingestImageBytes({ bytes: rendered.jpegBytes });
  if (input.hasAttachedImageContent(asset.sha256)) {
    return JSON.stringify(WorkspaceReadFileResultSchema.parse({
      data: { ...base, attachment_status: 'already_attached' },
      observation: `${label}；相同像素已在当前 run 的模型上下文中，本次未重复附加。`,
    }), null, 2);
  }
  const selectionId = `read-file-pdf-page:${createHash('sha256').update(`${input.source.locator}\u0000${pageNumber}`).digest('hex')}`;
  const [claim] = input.claims.issueClaims({
    conversationId: input.conversationId,
    toolCallId: input.toolCallId,
    selections: [{ selectionId, assetId: asset.assetId }],
  });
  if (!claim || claim.selectionId !== selectionId) {
    throw new Error('[READ_FILE_TOOL_RESULT_CLAIM_MISSING] 图片 claim registry 未返回对应选择。');
  }
  return JSON.stringify(WorkspaceReadFileResultSchema.parse({
    data: { ...base, attachment_status: 'attached' },
    observation: `${label}；真实像素已附加到本次工具结果。`,
    modelInput: { attachments: [{ id: selectionId, uri: claim.uri }] },
  }), null, 2);
}

export async function readPdfForTool(input: PdfReadInput): Promise<string> {
  if (input.hasExplicitLineWindow) {
    throw new PhysicalFileReadError(
      'READ_FILE_PDF_WINDOW_CONFLICT',
      'PDF 按页读取：用 pages（如 "15-18"）或 find，不用 offset/limit。',
    );
  }
  return withPdfSession(input, session => {
    if (input.request.view === 'page_image') {
      return renderPage(input, session, parsePdfPageRange(input.request.pages).from);
    }
    return input.request.find !== undefined
      ? findPages(input, session, input.request.find, input.request.pages)
      : readPages(input, session, input.request.pages);
  });
}
