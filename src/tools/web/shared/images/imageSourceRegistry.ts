import type { ImageLicense } from '@app/schemas';
import { normalizeUrl } from '../../websearch/citations/normalizeUrl';

/**
 * 图片在哪里被看到、带着什么来源说明。image_search 与 web_read 的页面图片候选写入，
 * web_read 下载同一地址时读出，写进回执，免得模型自己抄许可。
 * 只是本进程内的近期记忆：应用重启或记录被挤出后，回执如实说明“来源未记录”。
 */
export interface ImageSourceRecord {
  readonly foundVia: 'image_search' | 'web_page';
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

const MAX_RECORDS = 2_000;

export class ImageSourceRegistry {
  private readonly records = new Map<string, ImageSourceRecord>();

  remember(url: string, record: ImageSourceRecord): void {
    const key = keyOf(url);
    if (!key) return;
    // 开放接口给出的结构化许可比网页上看到的更具体，不被后来的网页记录覆盖。
    const existing = this.records.get(key);
    if (existing?.license && !record.license) return;
    this.records.delete(key);
    this.records.set(key, record);
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }

  lookup(...urls: readonly string[]): ImageSourceRecord | undefined {
    for (const url of urls) {
      const key = keyOf(url);
      const record = key ? this.records.get(key) : undefined;
      if (record) return record;
    }
    return undefined;
  }
}

function keyOf(url: string): string | undefined {
  try {
    return normalizeUrl(url);
  } catch {
    return undefined;
  }
}

let sharedRegistry: ImageSourceRegistry | undefined;

export function getImageSourceRegistry(): ImageSourceRegistry {
  sharedRegistry ??= new ImageSourceRegistry();
  return sharedRegistry;
}
