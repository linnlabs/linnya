import type {
  WebCacheLookup,
  WebCacheWrite,
  WebDocumentCacheValue,
  WebSearchCacheValue,
} from '../definitions/webCache';

/** Web 缓存窄契约；业务编排不感知文件、SQLite 或内存实现。 */
export interface WebCachePort {
  /** in-flight key 的隔离命名空间，禁止不同工作区或测试缓存互相合并。 */
  readonly namespace: string;
  readSearch(key: string): Promise<WebCacheLookup<WebSearchCacheValue>>;
  writeSearch(entry: WebCacheWrite<WebSearchCacheValue>): Promise<void>;
  readDocument(key: string): Promise<WebCacheLookup<WebDocumentCacheValue>>;
  writeDocument(entry: WebCacheWrite<WebDocumentCacheValue>): Promise<void>;
}

