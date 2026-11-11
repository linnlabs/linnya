/**
 * 网页下载的 PDF：用与 read_file 相同的 PDF.js 文字层与版面分析按页取文字、跨页查找。
 * 字节来自本次 HTTP 取得的原件（已存进会话目录），页文字按内容 sha256 缓存，同一 PDF 的续读不再解析。
 * 不调用任何模型；扫描页只报告没有文字层。
 */

import type { WebAcquiredFile } from '@app/schemas';
import {
  PdfOpenError,
  PdfPageTextCache,
  collectPdfPageWindow,
  findInPdfPages,
  withPdfTextSession,
  type PdfPageText,
} from 'src/features/parsers/pdfParser';

export interface WebPdfTextResult {
  /** 带页码标记的页文字或查找上下文，进入不可信内容边界与 Evidence。 */
  readonly content: string;
  readonly pageCount: number;
  readonly from: number;
  readonly to: number;
  readonly nextPages?: string;
  readonly stoppedEarly: boolean;
  readonly requestedBeyondEnd: boolean;
  readonly pagesWithoutText: readonly number[];
  readonly complexLayoutPages: readonly number[];
  readonly find?: {
    readonly query: string;
    readonly hitCount: number;
    readonly hitPages: readonly number[];
    readonly truncated: boolean;
  };
}

export type WebPdfTextOutcome =
  | { readonly status: 'read'; readonly result: WebPdfTextResult }
  | { readonly status: 'unreadable'; readonly reason: string };

function parsePages(value: string | undefined): { readonly from: number; readonly to: number } | undefined {
  if (!value) return undefined;
  const [from, to = from] = value.split('-').map(Number);
  return { from: from!, to: to! };
}

function layoutFacts(pages: readonly PdfPageText[]) {
  return {
    pagesWithoutText: pages.filter(page => page.layout === 'no_text').map(page => page.pageNumber),
    complexLayoutPages: pages.filter(page => page.layout === 'complex').map(page => page.pageNumber),
  };
}

export async function readWebPdfText(input: {
  readonly file: WebAcquiredFile;
  readonly bytes: Uint8Array;
  readonly pages?: string;
  readonly find?: string;
  readonly signal?: AbortSignal;
}): Promise<WebPdfTextOutcome> {
  try {
    return await withPdfTextSession(
      {
        key: PdfPageTextCache.contentKey(input.file.sha256),
        loadBytes: async () => input.bytes,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      async session => {
        const requested = parsePages(input.pages);
        if (input.find !== undefined) {
          const found = await findInPdfPages(session, input.find, requested, input.signal);
          return {
            status: 'read' as const,
            result: {
              content: found.contexts.map(match => `[Page ${match.pageNumber}] ${match.context}`).join('\n'),
              pageCount: session.pageCount,
              from: found.from,
              to: found.to,
              ...(found.nextPages ? { nextPages: found.nextPages } : {}),
              stoppedEarly: false,
              requestedBeyondEnd: false,
              ...layoutFacts(found.pages),
              find: {
                query: input.find,
                hitCount: found.hitCount,
                hitPages: found.hitPages,
                truncated: found.truncated,
              },
            },
          };
        }
        const window = await collectPdfPageWindow(session, requested, input.signal);
        return {
          status: 'read' as const,
          result: {
            content: window.pages
              .map(page => (page.layout === 'no_text'
                ? `[Page ${page.pageNumber}: no text layer]`
                : `[Page ${page.pageNumber}]\n${page.text}`))
              .join('\n\n'),
            pageCount: session.pageCount,
            from: window.from,
            to: window.to,
            ...(window.nextPages ? { nextPages: window.nextPages } : {}),
            stoppedEarly: window.stoppedEarly,
            requestedBeyondEnd: window.requestedBeyondEnd,
            ...layoutFacts(window.pages),
          },
        };
      },
    );
  } catch (error: unknown) {
    if (error instanceof PdfOpenError) return { status: 'unreadable', reason: error.reason };
    throw error;
  }
}
