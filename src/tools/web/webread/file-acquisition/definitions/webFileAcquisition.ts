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
