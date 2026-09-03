/**
 * @file src/tools/webread/providers/metaso.ts
 * @description 秘塔（Metaso）Reader Provider 实现
 */

import type { WebReadServiceRequest } from '../definitions/webReadService';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';
import { metasoReaderFetch } from '../../../../infra/adapters/web-read/metasoReaderAdapter';
import { createWebReadResult } from '../functions/createWebReadResult';

export class MetasoReaderProvider implements WebReadProvider {
  readonly name = 'metaso_reader';
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(config: WebReadServiceRequest) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey;
    if (!this.apiKey) {
      throw new Error(
        '秘塔 Reader API Key 未配置。'
      );
    }
  }

  async read(params: WebReadParams): Promise<WebReadResult> {
    const result = await metasoReaderFetch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      request: { url: params.url },
      signal: params.signal,
    });

    return createWebReadResult({
      url: params.url,
      status: 200,
      contentType: 'text/markdown',
      title: result.title,
      content: result.content,
      contentFormat: 'markdown',
      extractor: 'metaso_reader',
      renderMode: 'managed',
      provider: this.name,
      maxChars: params.maxChars,
      rawLength: result.charCount,
      latencyMs: result.tookMs,
    });
  }
}
