import type { ImageLicense } from '@app/schemas';
import { normalizeUrl } from '../../websearch/citations/normalizeUrl';

/**
 * 图片在哪里被看到、带着什么来源说明。image_search 与 web_read 的页面图片候选写入，
 * web_read 下载同一地址时读出，写进回执，免得模型自己抄许可。
 * 记录按对话划分：一个对话只能读到自己（含 child run）记下的来源，对话删除时整批回收。
 * 只是本进程内的近期记忆：应用重启或记录被挤出后，回执如实说明“来源未记录”。
 */
export interface ImageSourceRecord {
  readonly foundVia: 'image_search' | 'web_page';
  /**
   * 网页记录的依据：`page_image` 是页面图片候选（figure、正文大图、og:image 的标记），
   * `text_link` 是正文里的图片链接文字。两者都只是网页自己的说法，未经核实。
   */
  readonly pageEvidence?: 'page_image' | 'text_link';
  /** 来源页：image_search 的文件页，或出现这张图的网页。 */
  readonly pageUrl: string;
  readonly provider?: string;
  readonly title?: string;
  readonly creator?: string;
  /** 只有开放图片接口给出结构化许可；网页上的图没有。 */
  readonly license?: ImageLicense;
  readonly attribution?: string;
  /** 网页上的图注、图片署名，以及页面的版权声明（原文，不可信）。 */
  readonly caption?: string;
  readonly credit?: string;
  readonly pageRights?: string;
}

const DEFAULT_MAX_RECORDS = 2_000;

/**
 * 可信程度：开放图片接口的结构化元数据 > 网页的图片标记 > 网页正文里的图片链接文字。
 * 任何网页都能给别人的图片地址配图注、写版权声明，所以较低一级的记录不能顶替已有的较高一级记录。
 */
function trustRank(record: ImageSourceRecord): number {
  if (record.foundVia === 'image_search') return 3;
  return record.pageEvidence === 'page_image' ? 2 : 1;
}

export class ImageSourceRegistry {
  /** 键是“对话 + 规范化地址”；Map 的插入顺序就是挤出顺序。 */
  private readonly records = new Map<string, ImageSourceRecord>();
  private readonly maxRecords: number;

  constructor(options: { readonly maxRecords?: number } = {}) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  get size(): number {
    return this.records.size;
  }

  remember(conversationId: string, url: string, record: ImageSourceRecord): void {
    const key = keyOf(conversationId, url);
    if (!key) return;
    const existing = this.records.get(key);
    if (existing && trustRank(existing) > trustRank(record)) return;
    this.records.delete(key);
    this.records.set(key, record);
    while (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }

  lookup(conversationId: string, ...urls: readonly string[]): ImageSourceRecord | undefined {
    for (const url of urls) {
      const key = keyOf(conversationId, url);
      const record = key ? this.records.get(key) : undefined;
      if (record) return record;
    }
    return undefined;
  }

  /** 对话删除后调用；清空工作目录不调用，聊天里看到过的来源仍然成立。 */
  forgetConversation(conversationId: string): void {
    const prefix = scopePrefix(conversationId);
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
  }
}

function scopePrefix(conversationId: string): string {
  return `${conversationId}\u0000`;
}

function keyOf(conversationId: string, url: string): string | undefined {
  if (!conversationId) return undefined;
  try {
    return scopePrefix(conversationId) + normalizeUrl(url);
  } catch {
    return undefined;
  }
}

let sharedRegistry: ImageSourceRegistry | undefined;

export function getImageSourceRegistry(): ImageSourceRegistry {
  sharedRegistry ??= new ImageSourceRegistry();
  return sharedRegistry;
}
