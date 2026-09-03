import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebDocumentWarning } from '../definitions/webDocument';
import {
  WebFailureError,
  type WebExtractionFailureStage,
  type WebFailureKind,
} from '../shared/webFailure';
import type { ResolvedWebHost } from '../shared/urlPolicy';
import type { WebReadEscalationReason } from '../webread/definitions/readLadder';
import {
  WebPageRenderError,
  type WebPageRenderer,
} from '../webread/definitions/webPageRenderer';
import { createWebReadResult } from '../webread/functions/createWebReadResult';
import { readWebPageWithLadder } from '../webread/orchestration/readLadder';
import { LocalHttpProvider } from '../webread/providers/localHttp';
import { LocalRenderProvider } from '../webread/providers/localRender';
import type { WebReadParams, WebReadProvider, WebReadResult } from '../webread/providers/types';

function createManagedResult(url: string): WebReadResult {
  return createWebReadResult({
    url,
    status: 200,
    contentType: 'text/markdown',
    title: 'Managed Article',
    content: '# Managed Article\n\n托管 Reader 返回的完整正文。',
    contentFormat: 'markdown',
    extractor: 'managed_fixture',
    renderMode: 'managed',
    provider: 'managed_fixture',
    rawLength: 34,
    latencyMs: 5,
  });
}

function createReadabilityResult(args: {
  warnings: WebDocumentWarning[];
  qualityScore: number;
  renderMode?: 'http' | 'js';
}): WebReadResult {
  return createWebReadResult({
    url: 'https://example.com/article',
    status: 200,
    contentType: 'text/html',
    title: args.renderMode === 'js' ? 'Rendered Article' : 'Local Article',
    content: args.renderMode === 'js' ? '渲染抽取正文' : '本地抽取正文',
    contentFormat: 'text',
    extractor: 'readability',
    renderMode: args.renderMode ?? 'http',
    provider: args.renderMode === 'js' ? 'local_render' : 'local_fixture',
    rawLength: 1_000,
    qualityScore: args.qualityScore,
    warnings: args.warnings,
    latencyMs: 2,
  });
}

function createManagedProvider() {
  const read = vi.fn(async (params: WebReadParams) => createManagedResult(params.url));
  const provider: WebReadProvider = { name: 'managed_fixture', read };
  return { provider, read };
}

function createRenderProvider(result: WebReadResult = createReadabilityResult({
  warnings: [],
  qualityScore: 1,
  renderMode: 'js',
})) {
  const read = vi.fn(async () => result);
  const provider: WebReadProvider = { name: 'local_render', read };
  return { provider, read };
}

function createFailingProvider(kind: WebFailureKind, name = 'failing_provider'): WebReadProvider {
  return {
    name,
    async read() {
      throw new WebFailureError(kind, `fixture failure: ${kind}`);
    },
  };
}

function createExtractionFailingProvider(
  stage: WebExtractionFailureStage,
  name = 'local_http',
): WebReadProvider {
  return {
    name,
    async read() {
      throw new WebFailureError('extraction_error', `fixture extraction failure: ${stage}`, {
        details: { extractionStage: stage },
      });
    },
  };
}

describe('R2 本地 HTTP → 本地渲染 → 托管读取阶梯', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/article') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><head><title>Local Article</title></head><body><article><h1>Local Article</h1><p>${'稳定的本地正文内容。'.repeat(50)}</p></article></body></html>`);
        return;
      }
      if (request.url === '/short') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><head><title>Short</title></head><body><article><h1>Short</h1><p>${'短正文。'.repeat(25)}</p></article></body></html>`);
        return;
      }
      if (request.url === '/plain') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('简短但完整的纯文本响应');
        return;
      }
      if (request.url === '/captcha') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><div class="h-captcha" data-sitekey="fixture">请完成人机验证</div></main></body></html>');
        return;
      }
      if (request.url === '/login') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main><form action="/login"><label>账号<input name="user"></label><label>密码<input type="password"></label></form></main></body></html>');
        return;
      }
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('forbidden');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('读取阶梯夹具未返回 TCP 地址。');
    port = address.port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const resolveFixtureHost = async (url: URL): Promise<ResolvedWebHost> => ({
    hostname: url.hostname,
    addresses: [{ address: '127.0.0.1', family: 4 }],
  });

  function createLocalProvider(): WebReadProvider {
    return new LocalHttpProvider({ resolveHost: resolveFixtureHost });
  }

  it('静态正文合格时直接返回，不启动渲染或托管读取', async () => {
    const render = createRenderProvider();
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/article` },
      {
        provider: createLocalProvider(),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'local_http',
      renderAttempted: false,
      escalated: false,
      readResult: { renderMode: 'http', extractor: 'readability' },
    });
    expect(render.read).not.toHaveBeenCalled();
    expect(managed.read).not.toHaveBeenCalled();
  });

  it('HTTP 正文过短时渲染一次，渲染合格便不调用托管 Reader', async () => {
    const render = createRenderProvider();
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/short` },
      {
        provider: createLocalProvider(),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'local_render',
      renderAttempted: true,
      escalated: false,
      readResult: { renderMode: 'js' },
    });
    expect(render.read).toHaveBeenCalledTimes(1);
    expect(managed.read).not.toHaveBeenCalled();
  });

  it('渲染正文仍不合格时才调用一次托管 Reader', async () => {
    const render = createRenderProvider(createReadabilityResult({
      warnings: ['content_too_short'],
      qualityScore: 0.5,
      renderMode: 'js',
    }));
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/short` },
      {
        provider: createLocalProvider(),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: true,
      escalated: true,
      escalationReason: 'content_too_short',
    });
    expect(render.read).toHaveBeenCalledTimes(1);
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('简短但完整的纯文本不套用 Readability 质量规则', async () => {
    const render = createRenderProvider();
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/plain` },
      {
        provider: createLocalProvider(),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      renderAttempted: false,
      escalated: false,
      readResult: { extractor: 'raw_text' },
    });
    expect(render.read).not.toHaveBeenCalled();
    expect(managed.read).not.toHaveBeenCalled();
  });

  it.each([
    { path: 'forbidden', reason: 'http_403' },
    { path: 'captcha', reason: 'captcha' },
    { path: 'login', reason: 'login_required' },
  ] satisfies Array<{ path: string; reason: WebReadEscalationReason }>) (
    '访问屏障 $reason 跳过本地渲染，直接调用一次托管 Reader',
    async ({ path, reason }) => {
      const render = createRenderProvider();
      const managed = createManagedProvider();
      const result = await readWebPageWithLadder(
        { url: `http://ladder.test:${port}/${path}` },
        {
          provider: createLocalProvider(),
          renderProvider: render.provider,
          managedProvider: managed.provider,
        },
      );

      expect(result).toMatchObject({
        renderAttempted: false,
        escalated: true,
        escalationReason: reason,
      });
      expect(render.read).not.toHaveBeenCalled();
      expect(managed.read).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { warnings: ['js_shell'], reason: 'js_required', qualityScore: 0.2 },
    { warnings: ['low_text_ratio'], reason: 'low_text_ratio', qualityScore: 0.6 },
    { warnings: ['table_dominant'], reason: 'table_list_dominant', qualityScore: 0.8 },
  ] satisfies Array<{
    warnings: WebDocumentWarning[];
    reason: WebReadEscalationReason;
    qualityScore: number;
  }>)('质量信号 $reason 触发一次本地渲染', async ({ warnings, qualityScore }) => {
    const render = createRenderProvider();
    const managed = createManagedProvider();
    const provider: WebReadProvider = {
      name: 'local_fixture',
      async read() {
        return createReadabilityResult({ warnings, qualityScore });
      },
    };

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/article' },
      { provider, renderProvider: render.provider, managedProvider: managed.provider },
    );

    expect(result).toMatchObject({
      selectedProvider: 'local_render',
      renderAttempted: true,
      escalated: false,
    });
    expect(render.read).toHaveBeenCalledTimes(1);
    expect(managed.read).not.toHaveBeenCalled();
  });

  it.each([
    { warnings: ['low_text_ratio'] },
    { warnings: ['table_dominant'] },
    { warnings: ['list_dominant'] },
  ] satisfies Array<{ warnings: WebDocumentWarning[] }>)(
    '足量正文保留比例 warning，但不再单独升级：$warnings',
    async ({ warnings }) => {
      const render = createRenderProvider();
      const managed = createManagedProvider();
      const provider: WebReadProvider = {
        name: 'local_fixture',
        async read() {
          return createWebReadResult({
            url: 'https://example.com/long-article',
            status: 200,
            contentType: 'text/html',
            title: 'Long Article',
            content: '足量正文。'.repeat(200),
            contentFormat: 'text',
            extractor: 'readability',
            renderMode: 'http',
            provider: 'local_fixture',
            rawLength: 50_000,
            qualityScore: 0.6,
            warnings,
            latencyMs: 2,
          });
        },
      };

      const result = await readWebPageWithLadder(
        { url: 'https://example.com/long-article' },
        { provider, renderProvider: render.provider, managedProvider: managed.provider },
      );

      expect(result).toMatchObject({
        selectedProvider: 'local_fixture',
        renderAttempted: false,
        escalated: false,
      });
      expect(render.read).not.toHaveBeenCalled();
      expect(managed.read).not.toHaveBeenCalled();
    },
  );

  it('显式关闭渲染时保持原有两层读取行为', async () => {
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/short` },
      {
        provider: createLocalProvider(),
        renderProvider: null,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: false,
      escalated: true,
      escalationReason: 'content_too_short',
    });
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('配置关闭渲染时跳过本地渲染，但仍可使用选中的托管 Reader', async () => {
    const managed = createManagedProvider();
    const result = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/short` },
      {
        provider: createLocalProvider(),
        managedProvider: managed.provider,
        config: { renderEnabled: false, managedReader: 'metaso_reader' },
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: false,
      escalated: true,
    });
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('关闭托管 Reader 后，本地合格仍成功，真正需要托管时返回 managed_disabled', async () => {
    const disabledConfig = { renderEnabled: false, managedReader: 'none' } as const;
    const localSuccess = await readWebPageWithLadder(
      { url: `http://ladder.test:${port}/article` },
      { provider: createLocalProvider(), config: disabledConfig },
    );
    expect(localSuccess).toMatchObject({ selectedProvider: 'local_http', escalated: false });

    await expect(readWebPageWithLadder(
      { url: `http://ladder.test:${port}/captcha` },
      { provider: createLocalProvider(), config: disabledConfig },
    )).rejects.toMatchObject({
      kind: 'managed_disabled',
      details: {
        escalationReason: 'captcha',
        renderAttempted: false,
      },
    });

    await expect(readWebPageWithLadder(
      { url: `http://ladder.test:${port}/short` },
      { provider: createLocalProvider(), config: disabledConfig },
    )).rejects.toMatchObject({
      kind: 'managed_disabled',
      details: {
        escalationReason: 'content_too_short',
        renderAttempted: false,
      },
    });
  });

  it.each([
    'network_error',
    'timeout',
  ] satisfies WebFailureKind[])('首跳 %s 会进入本地渲染，并保留初始失败原因', async (kind) => {
    const render = createRenderProvider();
    const managed = createManagedProvider();

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: createFailingProvider(kind, 'local_http'),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'local_render',
      renderAttempted: true,
      escalated: false,
      escalationReason: kind,
      initialFailureKind: kind,
    });
    expect(render.read).toHaveBeenCalledTimes(1);
    expect(managed.read).not.toHaveBeenCalled();
  });

  it('DOM 规范化失败会进入 Chromium，并保留初始抽取阶段', async () => {
    const render = createRenderProvider();
    const managed = createManagedProvider();

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/malformed' },
      {
        provider: createExtractionFailingProvider('dom_canonicalization'),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'local_render',
      renderAttempted: true,
      escalationReason: 'extraction_error',
      initialFailureKind: 'extraction_error',
      initialFailureStage: 'dom_canonicalization',
    });
    expect(render.read).toHaveBeenCalledTimes(1);
    expect(managed.read).not.toHaveBeenCalled();
  });

  it('canonical DOM 上的 Readability 失败跳过机械渲染，直接进入托管 Reader', async () => {
    const render = createRenderProvider();
    const managed = createManagedProvider();

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/extraction-failure' },
      {
        provider: createExtractionFailingProvider('readability'),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: false,
      escalated: true,
      escalationReason: 'extraction_error',
      initialFailureKind: 'extraction_error',
      initialFailureStage: 'readability',
    });
    expect(render.read).not.toHaveBeenCalled();
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('抽取失败且未启用托管 Reader 时返回稳定错误码和阶段', async () => {
    await expect(readWebPageWithLadder(
      { url: 'https://example.com/extraction-failure' },
      {
        provider: createExtractionFailingProvider('readability'),
        renderProvider: null,
        config: { renderEnabled: false, managedReader: 'none' },
      },
    )).rejects.toMatchObject({
      kind: 'managed_disabled',
      message: expect.stringContaining('[WEB_READ_MANAGED_DISABLED]'),
      details: {
        escalationReason: 'extraction_error',
        initialFailureKind: 'extraction_error',
        extractionStage: 'readability',
        renderAttempted: false,
      },
    });
  });

  it.each([
    'network_error',
    'timeout',
  ] satisfies WebFailureKind[])('关闭渲染时，首跳 %s 直接进入已配置的托管 Reader', async (kind) => {
    const managed = createManagedProvider();

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: createFailingProvider(kind, 'local_http'),
        renderProvider: null,
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: false,
      escalated: true,
      escalationReason: kind,
      initialFailureKind: kind,
    });
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('本地网络失败且未启用托管时，managed_disabled 保留真实前因', async () => {
    const initialError = new WebFailureError('network_error', 'fixture connection refused');
    const provider: WebReadProvider = {
      name: 'local_http',
      async read() {
        throw initialError;
      },
    };

    await expect(readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider,
        renderProvider: null,
        config: { renderEnabled: false, managedReader: 'none' },
      },
    )).rejects.toMatchObject({
      kind: 'managed_disabled',
      message: expect.stringContaining('network_error'),
      details: {
        escalationReason: 'network_error',
        initialFailureKind: 'network_error',
        previousFailureKind: 'network_error',
        previousFailureMessage: 'fixture connection refused',
        renderAttempted: false,
      },
    });
  });

  it.each([
    'policy_denied',
    'aborted',
    'body_too_large',
    'dns_error',
    'http_5xx',
    'unsupported_mime',
    'http_404',
  ] satisfies WebFailureKind[])('首跳终态 %s 不得触发渲染或托管读取', async (kind) => {
    const render = createRenderProvider();
    const managed = createManagedProvider();

    await expect(readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: createFailingProvider(kind),
        renderProvider: render.provider,
        managedProvider: managed.provider,
      },
    )).rejects.toMatchObject({ kind });
    expect(render.read).not.toHaveBeenCalled();
    expect(managed.read).not.toHaveBeenCalled();
  });

  it.each([
    'timeout',
    'network_error',
  ] satisfies WebFailureKind[])('渲染 %s 会托管兜底，渲染安全拒绝则保持终态', async (kind) => {
    const managed = createManagedProvider();
    const initialProvider: WebReadProvider = {
      name: 'local_fixture',
      read: async () => createReadabilityResult({ warnings: ['js_shell'], qualityScore: 0.2 }),
    };
    const recovered = await readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: initialProvider,
        renderProvider: createFailingProvider(kind, 'local_render'),
        managedProvider: managed.provider,
      },
    );
    expect(recovered).toMatchObject({
      renderAttempted: true,
      escalated: true,
      escalationReason: kind,
    });
    expect(managed.read).toHaveBeenCalledTimes(1);

    await expect(readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: initialProvider,
        renderProvider: createFailingProvider('policy_denied', 'local_render'),
        managedProvider: managed.provider,
      },
    )).rejects.toMatchObject({ kind: 'policy_denied' });
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('渲染后的抽取错误只进入一次托管 Reader', async () => {
    const managed = createManagedProvider();
    const initialProvider: WebReadProvider = {
      name: 'local_fixture',
      read: async () => createReadabilityResult({ warnings: ['js_shell'], qualityScore: 0.2 }),
    };

    const result = await readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: initialProvider,
        renderProvider: createExtractionFailingProvider('readability', 'local_render'),
        managedProvider: managed.provider,
      },
    );

    expect(result).toMatchObject({
      selectedProvider: 'managed_fixture',
      renderAttempted: true,
      escalated: true,
      escalationReason: 'extraction_error',
    });
    expect(managed.read).toHaveBeenCalledTimes(1);
  });

  it('托管兜底失败后直接返回错误，不重试同一 Provider', async () => {
    const managedError = new WebFailureError('provider_error', 'managed failed');
    const managedRead = vi.fn(async (): Promise<WebReadResult> => {
      throw managedError;
    });
    const managedProvider: WebReadProvider = { name: 'managed_fixture', read: managedRead };
    const render = createRenderProvider();

    await expect(readWebPageWithLadder(
      { url: 'https://example.com/article' },
      {
        provider: createFailingProvider('captcha'),
        renderProvider: render.provider,
        managedProvider,
      },
    )).rejects.toBe(managedError);
    expect(render.read).not.toHaveBeenCalled();
    expect(managedRead).toHaveBeenCalledTimes(1);
  });

  it('整条读取阶梯超过总预算时取消当前跳并返回 timeout', async () => {
    const provider: WebReadProvider = {
      name: 'slow_local',
      read: ({ signal }) => new Promise<WebReadResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new WebFailureError('aborted', 'fixture aborted'));
        }, { once: true });
      }),
    };

    await expect(readWebPageWithLadder(
      { url: 'https://example.com/slow' },
      { provider, renderProvider: null, totalTimeoutMs: 5 },
    )).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('R2 本地渲染 Provider', () => {
  it('通过渲染 port 获取最终 DOM，并复用 Readability 产出 js 文档', async () => {
    const renderer: WebPageRenderer = {
      render: vi.fn().mockResolvedValue({
        finalUrl: 'https://example.com/rendered',
        html: `<!doctype html><html><head><title>Rendered Article</title></head><body><article><h1>Rendered Article</h1><p>${'渲染后出现的正文。'.repeat(80)}</p></article></body></html>`,
      }),
    };
    const result = await new LocalRenderProvider({ renderer }).read({
      url: 'https://example.com/spa',
    });

    expect(result).toMatchObject({
      finalUrl: 'https://example.com/rendered',
      title: 'Rendered Article',
      renderMode: 'js',
      extractor: 'readability',
      provider: 'local_render',
      warnings: [],
    });
    expect(result.content).toContain('渲染后出现的正文');
  });

  it('渲染后的应用正文由语义 DOM 抽取器接管', async () => {
    const renderer: WebPageRenderer = {
      render: vi.fn().mockResolvedValue({
        finalUrl: 'https://example.com/semantic-app',
        html: `<!doctype html><html><head><title>Semantic App</title></head><body><main><h1>Rendered Semantic Content</h1><textarea readonly>${'渲染后的可访问正文。'.repeat(100)}</textarea></main></body></html>`,
      }),
    };
    const result = await new LocalRenderProvider({ renderer }).read({
      url: 'https://example.com/semantic-app',
    });

    expect(result).toMatchObject({
      extractor: 'semantic_dom',
      renderMode: 'js',
      title: 'Rendered Semantic Content',
    });
    expect(result.content).toContain('渲染后的可访问正文');
  });

  it('把渲染安全边界错误映射为读取终态', async () => {
    const renderer: WebPageRenderer = {
      async render() {
        throw new WebPageRenderError('navigation_blocked', 'blocked');
      },
    };
    await expect(new LocalRenderProvider({ renderer }).read({
      url: 'https://example.com/spa',
    })).rejects.toMatchObject({ kind: 'policy_denied' });
  });
});
