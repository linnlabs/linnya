import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createToolCallDecisionEvent, createToolOutputEvent, routeRuntimeEvent,
  RunIdSchema, ToolCallIdSchema, type RoutedRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { WebReadResultSchema, WebSearchResultSchema } from '@app/schemas';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { MemoryWebCache } from 'src/tools/web/shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from 'src/tools/web/shared/cache/webCacheFactory';
import { WebReadTool } from 'src/tools/web/webread/WebReadTool';
import { LocalHttpProvider } from 'src/tools/web/webread/providers/localHttp';
import { WebFailureError } from 'src/tools/web/shared/webFailure';
import type { ToolContext } from 'src/tools/types';
import { CONVERSATION_SCHEMAS } from '../../persistence/event-store/conversation.schema';
import { serializeStoredRuntimeEvent } from '../../persistence/event-store/functions/runtimeEventStorageCodec';
import { readConversationToolHistory, readConversationWebSourceUrls } from '../../persistence/event-store';
import { createWebReadAccessHistory } from '../createWebReadAccessHistory';

function openDatabase(file = ':memory:'): Database.Database {
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY)');
  // 使用正式表和正式事件 codec；独立于 UI 及可关闭的审计。
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  return db;
}

function saveEvent(db: Database.Database, event: RoutedRuntimeEvent): void {
  db.prepare('INSERT OR IGNORE INTO conversations (conversation_id, created_at, last_event_at) VALUES (?, 1, 1)').run(event.conversation_id);
  db.prepare(`INSERT OR IGNORE INTO runs (id, conversation_id, kind, status, start_ts, parent_run_id)
    VALUES (?, ?, 'agent', 'running', 1, ?)`)
    .run(event.run_id, event.conversation_id, event.parent_run_id ?? null);
  db.prepare('INSERT INTO events (id, run_id, type, payload, ts) VALUES (?, ?, ?, ?, ?)')
    .run(event.id, event.run_id, event.type, serializeStoredRuntimeEvent(event), event.timestamp);
}

function seedCall(db: Database.Database, input: {
  conversation?: string; run?: string; call: string; url?: string; code?: string;
  success?: boolean; pending?: boolean; toolName?: string; largeText?: string; argsShape?: 'direct' | 'payload';
  data?: Record<string, unknown>;
}): void {
  const conversation = input.conversation ?? 'conversation-web-history';
  const run = input.run ?? 'root';
  const tool = input.toolName ?? 'web_read';
  const route = { run_id: run, ...(run === 'child' ? { parent_run_id: 'root' } : {}),
    lane: run === 'child' ? 'child' as const : 'foreground' as const,
    visibility: run === 'child' ? 'parent-trace' as const : 'conversation' as const };
  const args = { url: input.url ?? 'https://blocked.test/page', ...(tool === 'web_read' ? {} : { content: input.largeText }) };
  const options = input.argsShape === 'direct' ? { args }
    : input.argsShape === 'payload' ? { payload: { args } }
      : { payload: { tool_calls: [{ id: input.call, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } };
  saveEvent(db, routeRuntimeEvent(createToolCallDecisionEvent(`${run}-${input.call}-decision`, conversation,
    'turn', tool, input.call, options), route));
  if (input.pending) return;
  saveEvent(db, routeRuntimeEvent(createToolOutputEvent(`${run}-${input.call}-output`, conversation, 'turn', tool, input.call,
    input.success ? { status: 'success', observation: input.largeText ?? 'captured', data: input.data ?? { body: input.largeText } }
      : { status: 'error', observation: input.largeText ?? 'failed', error: 'failed', error_code: input.code, ...(input.data ? { data: input.data } : {}) }), route));
}

function sourceReadData(url: string, resourceUrl?: string): Record<string, unknown> {
  return WebReadResultSchema.parse({
    data: {
      url, title: '取得的页面', charCount: 12, truncated: false, provider: 'fixture',
      renderMode: 'http', extractor: 'fixture', renderAttempted: false, escalated: false,
      citations: { query: url, searchMode: 'web', citations: [
        { sourceType: 'web', ref: 'ABC234', index: 1, url, docTitle: '取得的页面', snippet: '正文摘要' },
      ] },
      ...(resourceUrl ? { resources: [{ kind: 'document', url: resourceUrl, label: '原报告' }] } : {}),
      evidence_store: { bundle_id: 'fixture-bundle' }, cacheStatus: 'miss',
    }, observation: '取得的正文',
  }).data;
}

function sourceSearchData(url: string): Record<string, unknown> {
  return WebSearchResultSchema.parse({
    data: {
      query: '研究资料', resultCount: 1,
      citations: { query: '研究资料', searchMode: 'web', citations: [
        { sourceType: 'web', ref: 'ABC234', index: 1, url, docTitle: '搜索结果', snippet: '搜索摘要' },
      ] }, evidence_store: { bundle_id: 'fixture-bundle' },
    }, observation: '搜索结果',
  }).data;
}

describe('Web 访问历史派生与实际读取反馈', () => {
  let server: Server;
  let port: number;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1;
      if (request.url === '/readable') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('已经取得的公开正文');
      } else {
        response.writeHead(403, { 'content-type': 'text/html' });
        response.end('<title>Captcha</title>UPSTREAM_UNTRUSTED_TEXT');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected fixture port');
    port = address.port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('只认正式成功搜索/读取的来源与资源，包含 child 并统一 URL 身份；不扫描参数、失败及任意文字', () => {
    const db = openDatabase();
    try {
      const history = createWebReadAccessHistory(() => db, 'conversation-web-history');
      const observed = history.hasObservedUrl;
      if (!observed) throw new Error('Expected URL history capability');
      seedCall(db, { call: 'search', success: true, toolName: 'web_search',
        data: sourceSearchData('https://source.test/search/?utm_source=fixture#section') });
      seedCall(db, { run: 'child', call: 'internal-search', success: true, toolName: 'search_web',
        data: sourceSearchData('https://source.test/internal') });
      seedCall(db, { run: 'child', call: 'read', success: true,
        data: sourceReadData('https://source.test/article', 'https://source.test/report.pdf'),
        largeText: `https://not-observed.test/observation ${'long-body'.repeat(100_000)}` });
      seedCall(db, { call: 'failed', code: 'http_404', url: 'https://not-observed.test/request',
        data: sourceReadData('https://not-observed.test/failed-data'),
        largeText: 'https://not-observed.test/error' });
      seedCall(db, { call: 'pending-url', pending: true, url: 'https://not-observed.test/pending' });
      seedCall(db, { call: 'unrelated', success: true, toolName: 'write_file',
        data: sourceReadData('https://not-observed.test/other-tool') });
      seedCall(db, { conversation: 'other-conversation', run: 'other-root', call: 'other-search',
        success: true, toolName: 'web_search', data: sourceSearchData('https://not-observed.test/other-conversation') });
      for (const url of ['https://source.test/search', 'https://source.test/internal',
        'https://source.test/article', 'https://source.test/report.pdf']) {
        expect(observed({ url })).toBe(true);
      }
      for (const url of ['https://not-observed.test/observation', 'https://not-observed.test/request',
        'https://not-observed.test/failed-data', 'https://not-observed.test/error',
        'https://not-observed.test/pending', 'https://not-observed.test/other-tool',
        'https://not-observed.test/other-conversation', 'https://blocked.test/page']) {
        expect(observed({ url })).toBe(false);
      }
      expect(observed({ url: 'https://source.test/report.pdf', currentRunId: 'child', currentToolCallId: 'read' })).toBe(false);
      const urls = [...readConversationWebSourceUrls(db, 'conversation-web-history')];
      expect(JSON.stringify(urls)).not.toContain('long-body');
      expect(urls.every(row => Object.keys(row).length === 3)).toBe(true);
    } finally { db.close(); }
  });

  it('原文件取得的请求/最终地址可识别；重载和删除不依赖缓存或另存索引', () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-source-url-history-'));
    const file = join(dir, 'fixture.sqlite');
    let db = openDatabase(file);
    try {
      const data = sourceReadData('https://source.test/file.pdf');
      data.charCount = 0;
      data.extractor = 'file_download';
      data.file = {
        path: `web-downloads/${'a'.repeat(64)}.pdf`, format: 'pdf', mimeType: 'application/pdf',
        byteLength: 12, sha256: 'a'.repeat(64), requestedUrl: 'https://source.test/download',
        finalUrl: 'https://source.test/file.pdf', acquiredAt: '2026-10-21T00:00:00.000Z',
        trust: 'untrusted_external_file',
      };
      const result = WebReadResultSchema.parse({ data, observation: '文件已取得' });
      seedCall(db, { run: 'child', call: 'file', success: true, data: result.data });
      const history = createWebReadAccessHistory(() => db, 'conversation-web-history');
      expect(history.hasObservedUrl?.({ url: 'https://source.test/download' })).toBe(true);
      db.close();
      db = openDatabase(file);
      expect(history.hasObservedUrl?.({ url: 'https://source.test/file.pdf' })).toBe(true);
      db.prepare('DELETE FROM events WHERE run_id = ?').run('child');
      expect(history.hasObservedUrl?.({ url: 'https://source.test/file.pdf' })).toBe(false);
      expect(history.hasObservedUrl?.({ url: 'https://source.test/download' })).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('从正式父子事件统计，排除当前调用、其它会话/主机、未完成和非阻断错误；重载及删除跟随事实', () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-access-history-'));
    const file = join(dir, 'fixture.sqlite');
    let db = openDatabase(file);
    try {
      seedCall(db, { call: 'blocked', code: 'captcha' });
      seedCall(db, { run: 'child', call: 'blocked', code: 'http_403' });
      seedCall(db, { run: 'child', call: 'ok', success: true, largeText: 'long-body'.repeat(100_000) });
      seedCall(db, { call: 'legacy', code: 'managed_disabled' });
      seedCall(db, { call: 'unknown' });
      seedCall(db, { call: 'timeout', code: 'timeout' });
      seedCall(db, { call: 'provider', code: 'provider_error' });
      seedCall(db, { call: 'cancelled', code: 'aborted' });
      seedCall(db, { call: 'pending', pending: true });
      seedCall(db, { call: 'subdomain', code: 'http_403', url: 'https://sub.blocked.test/article' });
      seedCall(db, { call: 'unrelated-tool', code: 'captcha', toolName: 'shell', largeText: 'ignored'.repeat(100_000) });
      seedCall(db, { conversation: 'other-conversation', run: 'other-root', call: 'other', code: 'captcha' });
      seedCall(db, { call: 'direct', argsShape: 'direct', url: 'https://direct.test/', code: 'login_required' });
      seedCall(db, { call: 'payload', argsShape: 'payload', url: 'https://direct.test/', success: true });
      saveEvent(db, routeRuntimeEvent(createToolOutputEvent('duplicate-terminal', 'conversation-web-history', 'turn',
        'web_read', 'direct', { status: 'error', observation: 'failed', error: 'failed', error_code: 'login_required' }), {
        run_id: 'root', lane: 'foreground', visibility: 'conversation',
      }));
      expect(createWebReadAccessHistory(() => db, 'conversation-web-history').read({ hostname: 'direct.test' }))
        .toEqual({ blocked: 1, succeeded: 1, unclassified: 0 });
      const query = { hostname: 'blocked.test', currentRunId: 'root', currentToolCallId: 'blocked' };
      const port = createWebReadAccessHistory(() => db, 'conversation-web-history');
      expect(port.read(query)).toEqual({ blocked: 1, succeeded: 1, unclassified: 2 });
      // 查询不物化任何 observation/error/data 正文，其他工具的大参数也不返回。
      const projected = [...readConversationToolHistory(db, 'conversation-web-history', 'web_read')];
      expect(JSON.stringify(projected)).not.toContain('long-body');
      expect(JSON.stringify(projected)).not.toContain('ignored');
      db.close();
      db = openDatabase(file);
      expect(createWebReadAccessHistory(() => db, 'conversation-web-history').read(query))
        .toEqual({ blocked: 1, succeeded: 1, unclassified: 2 });
      db.prepare('DELETE FROM events WHERE run_id = ?').run('child');
      expect(port.read(query)).toEqual({ blocked: 0, succeeded: 0, unclassified: 2 });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('已确认 403/验证码失败携带历史计数，仍允许同主机新页成功且缓存不串会话', async () => {
    const db = openDatabase();
    try {
      seedCall(db, { call: 'earlier', code: 'captcha' });
      seedCall(db, { run: 'child', call: 'earlier', success: true });
      seedCall(db, { call: 'old', code: 'managed_disabled' });
      const history = createWebReadAccessHistory(() => db, 'conversation-web-history');
      const context: ToolContext = {
        conversationId: 'conversation-web-history', turnId: 'turn', runId: RunIdSchema.parse('root'),
        parentToolCallId: ToolCallIdSchema.parse('new'), webReadAccessHistory: history,
      };
      attachCitationSequence(context, { offset: 0 });
      attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
      const tool = new WebReadTool({
        provider: new LocalHttpProvider({ resolveHost: async url => ({ hostname: url.hostname,
          addresses: [{ address: '127.0.0.1', family: 4 }] }) }),
        renderProvider: null, managedProvider: null,
        config: { renderEnabled: false, managedReader: 'none' },
        evidenceWriter: { async save() { return { bundleId: '0123456789abcdef' }; } },
      });
      const before = requests;
      await expect(tool.run({ url: `http://blocked.test:${port}/blocked` }, context)).rejects.toMatchObject({
        kind: 'managed_disabled', code: 'http_403',
        message: expect.stringMatching(/访问拦截 2 次.*成功返回 1 次.*1 次历史失败/u),
      });
      expect(requests - before).toBe(1);
      const success = WebReadResultSchema.parse(JSON.parse(await tool.run({ url: `http://blocked.test:${port}/readable` }, context)));
      expect(success.observation).toContain('已经取得的公开正文');
      expect(success.observation).not.toContain('UPSTREAM_UNTRUSTED_TEXT');
      expect(requests - before).toBe(2);
    } finally { db.close(); }
  });

  it('同时失败共享取件时，各会话反馈独立；超时、未知错误和取消不查询阻断计数', async () => {
    const shared = new WebFailureError('managed_disabled', 'local unavailable', { details: { previousFailureKind: 'captcha' } });
    const read = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 1)); throw shared; });
    const tool = new WebReadTool({ provider: { name: 'fixture', read }, renderProvider: null,
      managedProvider: null, config: { renderEnabled: false, managedReader: 'none' },
      cacheRuntime: createWebCacheRuntime(new MemoryWebCache()) });
    const historyA = { read: vi.fn(() => ({ blocked: 4, succeeded: 2, unclassified: 0 })) };
    const historyB = { read: vi.fn(() => ({ blocked: 0, succeeded: 0, unclassified: 0 })) };
    const context = (id: string, history: typeof historyA): ToolContext => {
      const value: ToolContext = { conversationId: id, turnId: 'turn', webReadAccessHistory: history };
      attachCitationSequence(value, { offset: 0 });
      return value;
    };
    const [a, b] = await Promise.allSettled([
      tool.run({ url: 'https://blocked.test/a' }, context('a', historyA)),
      tool.run({ url: 'https://blocked.test/a' }, context('b', historyB)),
    ]);
    if (a.status !== 'rejected' || b.status !== 'rejected') throw new Error('Expected two failures');
    expect(a.reason).toMatchObject({ message: expect.stringContaining('访问拦截 5 次') });
    expect(b.reason).toMatchObject({ message: expect.stringContaining('访问拦截 1 次') });
    expect(shared.message).toBe('local unavailable');
    expect(read).toHaveBeenCalledTimes(1);
    for (const kind of ['timeout', 'provider_error', 'aborted'] as const) {
      const history = { read: vi.fn(() => ({ blocked: 0, succeeded: 0, unclassified: 0 })) };
      const failing = new WebReadTool({ provider: { name: 'fixture', async read() { throw new WebFailureError(kind, kind); } },
        renderProvider: null, managedProvider: null, config: { renderEnabled: false, managedReader: 'none' } });
      await expect(failing.run({ url: 'https://blocked.test/error' }, context('a', history))).rejects.toBeInstanceOf(Error);
      expect(history.read).not.toHaveBeenCalled();
    }
  });
});
