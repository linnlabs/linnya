import type {
  WebCacheEntry,
  WebCacheLookup,
  WebCacheWrite,
  WebDocumentCacheValue,
  WebSearchCacheValue,
} from '../definitions/webCache';
import type { WebCachePort } from '../ports/webCache';

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_STALE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
let nextMemoryCacheId = 1;

interface MemoryEntry<T> extends WebCacheEntry<T> {
  staleUntilMs: number;
}

export class MemoryWebCache implements WebCachePort {
  readonly namespace: string;
  private readonly searchEntries = new Map<string, MemoryEntry<WebSearchCacheValue>>();
  private readonly documentEntries = new Map<string, MemoryEntry<WebDocumentCacheValue>>();

  constructor(private readonly options: {
    now?: () => number;
    maxEntries?: number;
    staleRetentionMs?: number;
    namespace?: string;
  } = {}) {
    this.namespace = options.namespace ?? `memory-web-cache-${nextMemoryCacheId++}`;
  }

  readSearch(key: string): Promise<WebCacheLookup<WebSearchCacheValue>> {
    return Promise.resolve(this.read(this.searchEntries, key));
  }

  writeSearch(entry: WebCacheWrite<WebSearchCacheValue>): Promise<void> {
    this.write(this.searchEntries, entry);
    return Promise.resolve();
  }

  readDocument(key: string): Promise<WebCacheLookup<WebDocumentCacheValue>> {
    return Promise.resolve(this.read(this.documentEntries, key));
  }

  writeDocument(entry: WebCacheWrite<WebDocumentCacheValue>): Promise<void> {
    this.write(this.documentEntries, entry);
    return Promise.resolve();
  }

  private read<T>(entries: Map<string, MemoryEntry<T>>, key: string): WebCacheLookup<T> {
    const entry = entries.get(key);
    if (!entry) return { state: 'miss' };
    const now = this.now();
    if (now >= entry.staleUntilMs) {
      entries.delete(key);
      return { state: 'miss' };
    }
    return {
      state: now < entry.expiresAtMs ? 'fresh' : 'stale',
      value: entry.value,
      storedAtMs: entry.storedAtMs,
      expiresAtMs: entry.expiresAtMs,
    };
  }

  private write<T>(entries: Map<string, MemoryEntry<T>>, entry: WebCacheWrite<T>): void {
    if (entry.ttlMs <= 0) return;
    const now = this.now();
    entries.delete(entry.key);
    entries.set(entry.key, {
      value: entry.value,
      storedAtMs: now,
      expiresAtMs: now + entry.ttlMs,
      staleUntilMs: now + entry.ttlMs + (this.options.staleRetentionMs ?? DEFAULT_STALE_RETENTION_MS),
    });
    while (entries.size > (this.options.maxEntries ?? DEFAULT_MAX_ENTRIES)) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

