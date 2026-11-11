/**
 * Agent 按页读 PDF 文字的共用会话：read_file（会话/宿主文件）与 web_read（网页下载的 PDF）
 * 都从这里取页文字、按预算截页窗口、跨页查找。只用 PDF.js 文字层与版面分析，不调用任何模型。
 */

import { WORKSPACE_READ_FILE_PDF_FIND_MAX_PAGES, WORKSPACE_READ_FILE_PDF_MAX_PAGES } from '@app/schemas';
import { findInText } from 'src/shared/text/findInText';
import { openPdfPageReader, type PdfPageReader, type PdfPageText } from './openPdfPageReader';

/** 约 16 MiB 的 UTF-16 文字；千页税则全文约 200 万字，也能整本留在缓存里。 */
const DEFAULT_MAX_CACHED_CHARS = 8_000_000;
const DEFAULT_MAX_DOCUMENTS = 16;

interface CachedPdf {
  readonly pageCount: number;
  readonly pages: Map<number, PdfPageText>;
  chars: number;
}

/**
 * 已提取的页文字按文件身份（真实路径、字节数、修改时间）缓存。只存文字，不存 PDF.js 文档：
 * 文档句柄持有字体和解析缓存，按次打开、读完即关。同一文件被改写后身份变化，旧条目自然失效。
 */
export class PdfPageTextCache {
  private readonly documents = new Map<string, CachedPdf>();
  private totalChars = 0;

  constructor(
    private readonly maxChars = DEFAULT_MAX_CACHED_CHARS,
    private readonly maxDocuments = DEFAULT_MAX_DOCUMENTS,
  ) {}

  static key(input: { readonly resolvedPath: string; readonly byteLength: number; readonly modifiedAtMs: number }): string {
    return `${input.resolvedPath}\u0000${input.byteLength}\u0000${input.modifiedAtMs}`;
  }

  /** 内容寻址的身份（网页下载的 PDF 按 sha256），与路径身份不会冲突。 */
  static contentKey(sha256: string): string {
    return `sha256:${sha256}`;
  }

  pageCount(key: string): number | undefined {
    return this.touch(key)?.pageCount;
  }

  get(key: string, pageNumber: number): PdfPageText | undefined {
    return this.touch(key)?.pages.get(pageNumber);
  }

  put(key: string, pageCount: number, page: PdfPageText): void {
    let entry = this.touch(key);
    if (!entry) {
      entry = { pageCount, pages: new Map(), chars: 0 };
      this.documents.set(key, entry);
    }
    if (entry.pages.has(page.pageNumber)) return;
    entry.pages.set(page.pageNumber, page);
    entry.chars += page.text.length;
    this.totalChars += page.text.length;
    this.evict(key);
  }

  /** Map 按插入顺序迭代；重新插入即标记为最近使用。 */
  private touch(key: string): CachedPdf | undefined {
    const entry = this.documents.get(key);
    if (!entry) return undefined;
    this.documents.delete(key);
    this.documents.set(key, entry);
    return entry;
  }

  private evict(protectedKey: string): void {
    for (const [key, entry] of this.documents) {
      if (this.totalChars <= this.maxChars && this.documents.size <= this.maxDocuments) return;
      if (key === protectedKey) continue;
      this.documents.delete(key);
      this.totalChars -= entry.chars;
    }
  }
}

/** PDF.js 打开大文件会占数百 MiB；App Server 同时只解析一份 PDF，其余排队。 */
export class SerialGate {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** PDF 打不开（加密、损坏或不是 PDF）。调用方映射成各自的工具错误。 */
export class PdfOpenError extends Error {
  constructor(readonly reason: string) {
    super(`PDF could not be opened: ${reason}`);
    this.name = 'PdfOpenError';
  }
}

export interface PdfTextSession {
  readonly pageCount: number;
  text(pageNumber: number): Promise<PdfPageText>;
  render(pageNumber: number): ReturnType<PdfPageReader['renderPageToJpeg']>;
}

const defaultCache = new PdfPageTextCache();
const defaultGate = new SerialGate();

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  throw error;
}

/**
 * 在串行闸门内打开一份 PDF：页文字先查缓存，缺页才读字节、打开 PDF.js；任务结束即关闭文档句柄。
 * loadBytes 只在需要解析时调用，缓存命中的整段读取不碰磁盘。
 */
export async function withPdfTextSession<T>(
  input: {
    readonly key: string;
    readonly loadBytes: () => Promise<Uint8Array>;
    readonly signal?: AbortSignal;
    readonly cache?: PdfPageTextCache;
    readonly gate?: SerialGate;
  },
  task: (session: PdfTextSession) => Promise<T>,
): Promise<T> {
  const cache = input.cache ?? defaultCache;
  return (input.gate ?? defaultGate).run(async () => {
    throwIfAborted(input.signal);
    let reader: PdfPageReader | undefined;
    const open = async (): Promise<PdfPageReader> => {
      if (reader) return reader;
      const bytes = await input.loadBytes();
      try {
        reader = await openPdfPageReader(bytes);
      } catch (error: unknown) {
        throw new PdfOpenError((error instanceof Error ? error.message : String(error)).slice(0, 200));
      }
      return reader;
    };
    try {
      const pageCount = cache.pageCount(input.key) ?? (await open()).pageCount;
      return await task({
        pageCount,
        async text(pageNumber) {
          const cached = cache.get(input.key, pageNumber);
          if (cached) return cached;
          const page = await (await open()).readPageText(pageNumber);
          cache.put(input.key, pageCount, page);
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

/**
 * 一次返回的页文字在页边界停下的预算（UTF-16 字符与行数）。Host 的工具输出预览为 20,000 字符 / 1,200 行，
 * 超出会截成前缀，末尾的续读提示随之丢失；这里留出页头、布局说明和续读提示的空间。
 * 第一页总会返回；单页本身超长时才交给 ToolOutputStore 续读。
 */
export const PDF_TEXT_WINDOW_CHARS = 15_000;
export const PDF_TEXT_WINDOW_LINES = 900;
/** 一次最多返回的页数与一次查找最多扫描的页数（read_file 与 web_read 共用同一参数合同）。 */
export const PDF_TEXT_MAX_PAGES = WORKSPACE_READ_FILE_PDF_MAX_PAGES;
export const PDF_FIND_MAX_PAGES = WORKSPACE_READ_FILE_PDF_FIND_MAX_PAGES;
const MAX_FIND_CONTEXTS = 30;

export const formatPdfPageSpan = (from: number, to: number): string => (from === to ? String(from) : `${from}-${to}`);

export class PdfPageOutOfRangeError extends Error {
  constructor(readonly pageNumber: number, readonly pageCount: number) {
    super(`The PDF has ${pageCount} pages; page ${pageNumber} does not exist.`);
    this.name = 'PdfPageOutOfRangeError';
  }
}

function requirePageInRange(pageNumber: number, pageCount: number): void {
  if (pageNumber > pageCount) throw new PdfPageOutOfRangeError(pageNumber, pageCount);
}

function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 0x0a) count += 1;
  return count;
}

export interface PdfPageWindow {
  readonly from: number;
  readonly to: number;
  readonly pages: readonly PdfPageText[];
  /** 预算在请求范围内提前停下。 */
  readonly stoppedEarly: boolean;
  readonly hasMore: boolean;
  /** 续读页码：提前停下时是本次请求剩余的页，完整返回时按同样页数向后翻。 */
  readonly nextPages?: string;
  readonly requestedBeyondEnd: boolean;
}

export async function collectPdfPageWindow(
  session: PdfTextSession,
  requested: { readonly from: number; readonly to: number } | undefined,
  signal?: AbortSignal,
): Promise<PdfPageWindow> {
  const from = requested?.from ?? 1;
  requirePageInRange(from, session.pageCount);
  const lastAllowed = Math.min(requested?.to ?? from + PDF_TEXT_MAX_PAGES - 1, session.pageCount);
  const pages: PdfPageText[] = [];
  let chars = 0;
  let lines = 0;
  for (let pageNumber = from; pageNumber <= lastAllowed; pageNumber += 1) {
    throwIfAborted(signal);
    const page = await session.text(pageNumber);
    const pageLines = countLines(page.text) + 2;
    if (pages.length > 0 && (chars + page.text.length > PDF_TEXT_WINDOW_CHARS || lines + pageLines > PDF_TEXT_WINDOW_LINES)) break;
    pages.push(page);
    chars += page.text.length;
    lines += pageLines;
  }
  const to = pages[pages.length - 1]!.pageNumber;
  const stoppedEarly = to < lastAllowed;
  const hasMore = to < session.pageCount;
  const nextPages = hasMore
    ? formatPdfPageSpan(to + 1, stoppedEarly ? lastAllowed : Math.min(to + pages.length, session.pageCount))
    : undefined;
  return {
    from,
    to,
    pages,
    stoppedEarly,
    hasMore,
    ...(nextPages ? { nextPages } : {}),
    requestedBeyondEnd: requested !== undefined && requested.to > session.pageCount,
  };
}

export interface PdfFindResult {
  readonly from: number;
  readonly to: number;
  readonly pages: readonly PdfPageText[];
  readonly hitCount: number;
  readonly hitPages: readonly number[];
  readonly contexts: readonly { readonly pageNumber: number; readonly context: string }[];
  /** 只展示了前若干处上下文。 */
  readonly truncated: boolean;
  readonly hasMore: boolean;
  readonly nextPages?: string;
}

export async function findInPdfPages(
  session: PdfTextSession,
  query: string,
  requested: { readonly from: number; readonly to: number } | undefined,
  signal?: AbortSignal,
): Promise<PdfFindResult> {
  const from = requested?.from ?? 1;
  requirePageInRange(from, session.pageCount);
  const scopeEnd = Math.min(requested?.to ?? session.pageCount, session.pageCount);
  const to = Math.min(scopeEnd, from + PDF_FIND_MAX_PAGES - 1);
  const pages: PdfPageText[] = [];
  const contexts: { pageNumber: number; context: string }[] = [];
  const hitPages: number[] = [];
  let hitCount = 0;
  for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
    throwIfAborted(signal);
    const page = await session.text(pageNumber);
    pages.push(page);
    const found = findInText(page.text, query, MAX_FIND_CONTEXTS - contexts.length);
    if (found.count === 0) continue;
    hitCount += found.count;
    hitPages.push(pageNumber);
    contexts.push(...found.matches.map(match => ({ pageNumber, context: match.context })));
  }
  const hasMore = to < scopeEnd;
  const nextPages = hasMore ? formatPdfPageSpan(to + 1, Math.min(to + PDF_FIND_MAX_PAGES, scopeEnd)) : undefined;
  return {
    from,
    to,
    pages,
    hitCount,
    hitPages,
    contexts,
    truncated: contexts.length < hitCount,
    hasMore,
    ...(nextPages ? { nextPages } : {}),
  };
}
