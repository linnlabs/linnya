/**
 * 正式文件（PDF/XLSX/CSV）的单次抓取截止时间，从请求开始计。普通网页仍用本地抓取默认预算；
 * 收到响应头确认为文件后才延长，并留在读取阶梯 90 秒总预算之内。
 */
export const WEB_FILE_FETCH_TIMEOUT_MS = 60_000;

import type { WebAcquiredFile } from '@app/schemas';

/** 仅在本次 HTTP/in-flight 中传递，不写入公共网页缓存或模型上下文。 */
export interface WebFilePayload {
  readonly bytes: Uint8Array;
  readonly format: WebAcquiredFile['format'];
}

export interface WebFileStore {
  save(
    input: WebFilePayload & {
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly mimeType: string;
      readonly acquiredAt: string;
      readonly signal?: AbortSignal;
    }
  ): Promise<WebAcquiredFile>;
}
