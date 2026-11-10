import type { PdfPageText } from 'src/features/parsers/pdfParser';

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
