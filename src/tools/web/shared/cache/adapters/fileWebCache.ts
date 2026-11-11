import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  WebDocumentWarningSchema,
  WebExtractionFailureStageSchema,
  WebFailureKindSchema,
  WebReadEscalationReasonSchema,
} from '@app/schemas';
import type {
  WebCacheLookup,
  WebCacheWrite,
  WebDocumentCacheValue,
  WebSearchCacheValue,
} from '../definitions/webCache';
import type { WebCachePort } from '../ports/webCache';

const DEFAULT_MAX_ENTRIES = 500;
/** 每类条目的目录字节上限；正文快照单条最多约 1.5 MB（50 万个中文字），条数上限之外的保险。 */
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_STALE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const searchResultSchema = z.object({
  query: z.string(),
  provider: z.string(),
  rank: z.number(),
  url: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  snippet: z.string(),
  siteName: z.string().optional(),
  publishedAt: z.string().optional(),
  language: z.string().optional(),
  sourceType: z.enum(['official', 'news', 'forum', 'academic', 'social', 'other']).optional(),
  providerScore: z.number().optional(),
  normalizedScore: z.number().optional(),
  cached: z.boolean(),
  latencyMs: z.number(),
});

const webReadResultSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  status: z.number(),
  contentType: z.string(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  publishedAt: z.string().optional(),
  language: z.string().optional(),
  // 读取结果的 text/markdown 与 content 相同；落盘只存 content 一份，读回时按 contentFormat 还原。
  text: z.string().optional(),
  markdown: z.string().optional(),
  contentFormat: z.enum(['text', 'markdown']).optional(),
  rawHtmlRef: z.string().optional(),
  extractor: z.string(),
  renderMode: z.enum(['http', 'js', 'managed']),
  provider: z.string().optional(),
  truncated: z.boolean(),
  tokenCount: z.number().optional(),
  rawLength: z.number(),
  fetchedAt: z.string(),
  cacheAgeSeconds: z.number().optional(),
  contentHash: z.string(),
  qualityScore: z.number().optional(),
  warnings: z.array(WebDocumentWarningSchema),
  resources: z.array(z.object({
    kind: z.enum(['document', 'doi', 'source']),
    url: z.string(),
    label: z.string().optional(),
  }).strict()).max(16).optional(),
  blockedReason: z.string().optional(),
  latencyMs: z.number(),
  estimatedCost: z.number().optional(),
  content: z.string(),
  charCount: z.number(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
});

const webReadLadderSchema = z.object({
  readResult: webReadResultSchema.transform(({ contentFormat, ...stored }) => ({
    ...stored,
    text: stored.text ?? stored.content,
    ...(stored.markdown !== undefined || contentFormat === 'markdown'
      ? { markdown: stored.markdown ?? stored.content }
      : {}),
  })),
  initialProvider: z.string(),
  selectedProvider: z.string(),
  renderAttempted: z.boolean(),
  escalated: z.boolean(),
  initialFailureKind: WebFailureKindSchema.optional(),
  initialFailureStage: WebExtractionFailureStageSchema.optional(),
  escalationReason: WebReadEscalationReasonSchema.optional(),
});

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && error.code === code;
}

/** 正文只落盘一份：text/markdown 与 content 相同时去掉，记下格式。 */
function compactDocumentForStorage(value: WebDocumentCacheValue): unknown {
  const { text, markdown, ...readResult } = value.readResult;
  return {
    ...value,
    readResult: {
      ...readResult,
      ...(text !== readResult.content ? { text } : {}),
      ...(markdown !== undefined && markdown !== readResult.content ? { markdown } : {}),
      ...(markdown === readResult.content ? { contentFormat: 'markdown' } : {}),
    },
  };
}

function fileNameForKey(key: string): string {
  return `${createHash('sha256').update(key).digest('hex')}.json`;
}

export class FileWebCache implements WebCachePort {
  readonly namespace: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private writesSincePrune = Number.POSITIVE_INFINITY;

  constructor(
    private readonly rootDir: string,
    private readonly options: {
      now?: () => number;
      maxEntries?: number;
      maxBytes?: number;
      staleRetentionMs?: number;
    } = {},
  ) {
    this.namespace = `file-web-cache:${path.resolve(rootDir)}`;
  }

  readSearch(key: string): Promise<WebCacheLookup<WebSearchCacheValue>> {
    return this.read('search', key, z.array(searchResultSchema));
  }

  writeSearch(entry: WebCacheWrite<WebSearchCacheValue>): Promise<void> {
    return this.enqueueWrite(() => this.write('search', entry));
  }

  readDocument(key: string): Promise<WebCacheLookup<WebDocumentCacheValue>> {
    return this.read('document', key, webReadLadderSchema);
  }

  writeDocument(entry: WebCacheWrite<WebDocumentCacheValue>): Promise<void> {
    return this.enqueueWrite(() => this.write('document', { ...entry, value: compactDocumentForStorage(entry.value) }));
  }

  private async read<T>(
    kind: 'search' | 'document',
    key: string,
    valueSchema: z.ZodType<T, unknown>,
  ): Promise<WebCacheLookup<T>> {
    const filePath = this.entryPath(kind, key);
    let text: string;
    try {
      text = await fsp.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return { state: 'miss' };
      throw error;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fsp.rm(filePath, { force: true });
      return { state: 'miss' };
    }
    const envelopeSchema = z.object({
      version: z.literal(1),
      key: z.string(),
      storedAtMs: z.number(),
      expiresAtMs: z.number(),
      staleUntilMs: z.number(),
      value: z.unknown(),
    });
    const parsed = envelopeSchema.safeParse(raw);
    const parsedValue = parsed.success ? valueSchema.safeParse(parsed.data.value) : null;
    if (!parsed.success || !parsedValue?.success || parsed.data.key !== key) {
      await fsp.rm(filePath, { force: true });
      return { state: 'miss' };
    }

    const now = this.now();
    if (now >= parsed.data.staleUntilMs) {
      await fsp.rm(filePath, { force: true });
      return { state: 'miss' };
    }
    return {
      state: now < parsed.data.expiresAtMs ? 'fresh' : 'stale',
      value: parsedValue.data,
      storedAtMs: parsed.data.storedAtMs,
      expiresAtMs: parsed.data.expiresAtMs,
    };
  }

  private async write(kind: 'search' | 'document', entry: WebCacheWrite<unknown>): Promise<void> {
    if (entry.ttlMs <= 0) return;
    const now = this.now();
    const filePath = this.entryPath(kind, entry.key);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const envelope = {
      version: 1,
      key: entry.key,
      storedAtMs: now,
      expiresAtMs: now + entry.ttlMs,
      staleUntilMs: now + entry.ttlMs + (this.options.staleRetentionMs ?? DEFAULT_STALE_RETENTION_MS),
      value: entry.value,
    };
    try {
      await fsp.writeFile(tempPath, JSON.stringify(envelope), 'utf-8');
      await fsp.rename(tempPath, filePath);
    } catch (error: unknown) {
      await fsp.rm(tempPath, { force: true });
      throw error;
    }

    this.writesSincePrune += 1;
    if (this.writesSincePrune >= 25) {
      this.writesSincePrune = 0;
      await this.prune(kind);
    }
  }

  private async prune(kind: 'search' | 'document'): Promise<void> {
    const dir = path.join(this.rootDir, kind);
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    const files = dirents.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;

    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    const withStats = await Promise.all(files.map(async (entry) => {
      const stat = await fsp.stat(path.join(dir, entry.name));
      return { filePath: path.join(dir, entry.name), mtimeMs: stat.mtimeMs, size: stat.size };
    }));
    let totalBytes = withStats.reduce((sum, entry) => sum + entry.size, 0);
    if (files.length <= maxEntries && totalBytes <= maxBytes) return;
    // 先删最久未写的条目，直到条数与字节都回到上限内。
    withStats.sort((left, right) => left.mtimeMs - right.mtimeMs);
    let remaining = withStats.length;
    const removals: string[] = [];
    for (const entry of withStats) {
      if (remaining <= maxEntries && totalBytes <= maxBytes) break;
      removals.push(entry.filePath);
      remaining -= 1;
      totalBytes -= entry.size;
    }
    await Promise.all(removals.map((filePath) => fsp.rm(filePath, { force: true })));
  }

  private entryPath(kind: 'search' | 'document', key: string): string {
    return path.join(this.rootDir, kind, fileNameForKey(key));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}
