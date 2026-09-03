import type { WebReadServiceRequest } from '../definitions/webReadService';
import {
  jinaReaderFetch,
  type JinaReaderEngine,
} from '../../../../infra/adapters/web-read/jinaReaderAdapter';
import type { WebReadParams, WebReadProvider, WebReadResult } from './types';
import { createWebReadResult } from '../functions/createWebReadResult';

export class JinaReaderProvider implements WebReadProvider {
  readonly name: string;
  readonly engine: JinaReaderEngine;
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(config: WebReadServiceRequest, options: { engine?: JinaReaderEngine } = {}) {
    this.apiBase = config.baseUrl;
    this.apiKey = config.apiKey;
    this.engine = options.engine ?? 'direct';
    this.name = `jina_reader_${this.engine}`;
    if (!this.apiKey) {
      throw new Error('Jina Reader API Key 未配置。');
    }
  }

  async read(params: WebReadParams): Promise<WebReadResult> {
    const result = await jinaReaderFetch({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      request: { url: params.url, engine: this.engine },
      signal: params.signal,
    });
    return createWebReadResult({
      url: params.url,
      finalUrl: result.url,
      status: 200,
      contentType: 'text/markdown',
      title: result.title,
      content: result.content,
      contentFormat: 'markdown',
      publishedAt: result.publishedAt,
      extractor: `jina_reader_${this.engine}`,
      renderMode: 'managed',
      provider: this.name,
      maxChars: params.maxChars,
      tokenCount: result.tokenCount,
      rawLength: result.charCount,
      latencyMs: result.tookMs,
      ...(result.tokenCount !== undefined
        ? { estimatedCost: result.tokenCount * 0.05 / 1_000_000 }
        : {}),
    });
  }
}
