import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShallowWebSearchResultSchema, WebReadResultSchema } from '@app/schemas';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import type { BaseTool, ToolContext } from 'src/tools/types';
import type { WebEvidenceWriter } from 'src/tools/web/shared/ports/webEvidenceWriter';
import { WebFailureError } from 'src/tools/web/shared/webFailure';
import { SearchWebTool } from 'src/tools/web/websearch/SearchWebTool';
import { WebSearchTool } from 'src/tools/web/websearch/WebSearchTool';
import type { WebSearchProvider } from 'src/tools/web/websearch/providers/types';
import * as searchProviders from 'src/tools/web/websearch/providers/factory';
import { WebReadTool } from 'src/tools/web/webread/WebReadTool';
import { createWebReadResult } from 'src/tools/web/webread/functions/createWebReadResult';
import type { WebReadProvider } from 'src/tools/web/webread/providers/types';
import * as readProviders from 'src/tools/web/webread/providers/factory';
import * as builtin from '../../../plugin-registry/builtin';
import { ToolRegistry, ToolRegistryInitializationError } from '../toolRegistry';

const pageUrl = 'https://example.com/article';

function createContext(): ToolContext {
  const context: ToolContext = { conversationId: 'tool-composition', turnId: 'read-sources' };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

function createDependencies(content: string) {
  // 两套依赖故意同名、同 URL；只有实例缓存隔离才能避免互相读到另一套正文。
  const search = vi.fn<WebSearchProvider['search']>().mockResolvedValue([
    {
      title: content,
      url: pageUrl,
      canonicalUrl: pageUrl,
      snippet: content,
      query: 'source question',
      provider: 'composed_search',
      rank: 1,
      cached: false,
      latencyMs: 1,
    },
  ]);
  const read = vi.fn<WebReadProvider['read']>().mockResolvedValue(
    createWebReadResult({
      url: pageUrl,
      status: 200,
      contentType: 'text/plain',
      title: content,
      content,
      contentFormat: 'text',
      extractor: 'raw_text',
      renderMode: 'http',
      provider: 'composed_read',
      rawLength: content.length,
      latencyMs: 1,
    })
  );
  const save = vi.fn<WebEvidenceWriter['save']>().mockResolvedValue({
    bundleId: '0123456789abcdef',
  });
  return { search, read, save };
}

function createRegistry(dependencies: ReturnType<typeof createDependencies>): ToolRegistry {
  return new ToolRegistry({
    strictInitialization: true,
    createTool(ToolClass, defaultTool) {
      const searchDependencies = {
        provider: { name: 'composed_search', search: dependencies.search },
        evidenceWriter: { save: dependencies.save },
      };
      if (ToolClass === WebSearchTool) return new WebSearchTool(searchDependencies);
      if (ToolClass === SearchWebTool) return new SearchWebTool(searchDependencies);
      if (ToolClass === WebReadTool) {
        return new WebReadTool({
          provider: { name: 'composed_read', read: dependencies.read },
          evidenceWriter: { save: dependencies.save },
          // 显式 null 必须盖过启用的默认阶梯配置，失败不能调用另一条网络路径。
          config: { renderEnabled: true, managedReader: 'jina_reader' },
          renderProvider: null,
          managedProvider: null,
        });
      }
      return defaultTool;
    },
  });
}

beforeEach(() => {
  vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([
    WebSearchTool,
    SearchWebTool,
    WebReadTool,
  ]);
  vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
  vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
  const unexpectedDefault = (): never => {
    throw new Error('Composition unexpectedly selected a default provider');
  };
  vi.spyOn(searchProviders, 'createWebSearchProvider').mockImplementation(unexpectedDefault);
  vi.spyOn(readProviders, 'createLocalWebReadProvider').mockImplementation(unexpectedDefault);
  vi.spyOn(readProviders, 'createLocalRenderWebReadProvider').mockImplementation(unexpectedDefault);
  vi.spyOn(readProviders, 'createWebReadProvider').mockImplementation(unexpectedDefault);
});

afterEach(() => vi.restoreAllMocks());

describe('registered tool composition', () => {
  it('正式搜索与读取链使用装配依赖、写 Evidence，并在实例内缓存且不串实例', async () => {
    for (const content of ['First source body', 'Second source body']) {
      const dependencies = createDependencies(content);
      const registry = createRegistry(dependencies);
      const context = createContext();
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const name of ['web_search', 'search_web']) {
          const result = await registry.executeTool(name, { query: 'source question' }, context);
          if (!result.success || typeof result.result !== 'string') {
            throw new Error(`Search failed: ${JSON.stringify(result)}`);
          }
          const output = ShallowWebSearchResultSchema.parse(JSON.parse(result.result));
          expect(output.data.citations.citations[0]?.snippet).toBe(content);
        }
        const result = await registry.executeTool('web_read', { url: pageUrl }, context);
        if (!result.success || typeof result.result !== 'string') {
          throw new Error(`Read failed: ${JSON.stringify(result)}`);
        }
        const output = WebReadResultSchema.parse(JSON.parse(result.result));
        expect(output.observation).toContain(content);
      }
      expect(dependencies.search).toHaveBeenCalledTimes(2);
      expect(dependencies.read).toHaveBeenCalledTimes(1);
      expect(dependencies.save).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ captureKind: 'web_page', contentText: content })],
        })
      );
    }
  });

  it('工厂实例继续经过执行范围、参数接纳及正式 decorator', async () => {
    const dependencies = createDependencies('Allowed source');
    const decorate = vi.fn();
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([
      { toolNames: ['search_web'], decorate },
    ]);
    const registry = createRegistry(dependencies);
    const context = createContext();
    context.registeredChildAllowedTools = [];
    expect(
      await registry.executeTool('search_web', { query: 'source question' }, context)
    ).toMatchObject({
      success: false,
      errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED',
    });
    context.registeredChildAllowedTools = ['search_web'];
    expect(
      await registry.executeTool(
        'search_web',
        { query: 'source question', deep_search: true },
        context
      )
    ).toMatchObject({
      success: false,
      errorKind: 'protocol',
    });
    expect(decorate).not.toHaveBeenCalled();
    expect(dependencies.search).not.toHaveBeenCalled();
    expect(
      await registry.executeTool('search_web', { query: 'source question' }, context)
    ).toMatchObject({
      success: true,
    });
    expect(decorate).toHaveBeenCalledTimes(1);
    expect(dependencies.search).toHaveBeenCalledTimes(1);
  });

  it('读取失败保留显式禁用的阶梯依赖，不回落到默认 Provider', async () => {
    const dependencies = createDependencies('Unavailable');
    dependencies.read.mockRejectedValue(new WebFailureError('network_error', 'Source unavailable'));
    const registry = createRegistry(dependencies);
    expect(await registry.executeTool('web_read', { url: pageUrl }, createContext())).toMatchObject(
      {
        success: false,
        errorKind: 'execution',
      }
    );
    expect(readProviders.createLocalWebReadProvider).not.toHaveBeenCalled();
    expect(readProviders.createLocalRenderWebReadProvider).not.toHaveBeenCalled();
    expect(readProviders.createWebReadProvider).not.toHaveBeenCalled();
    expect(dependencies.save).not.toHaveBeenCalled();
  });

  it('未定制工具复用默认实例，工厂改名或抛错均按 strict 接纳失败', () => {
    const defaults: BaseTool[] = [];
    const registry = new ToolRegistry({
      strictInitialization: true,
      createTool(_ToolClass, defaultTool) {
        defaults.push(defaultTool);
        return defaultTool;
      },
    });
    expect(registry.getAllTools()).toEqual(defaults);
    const renamed = new ToolRegistry({
      strictInitialization: true,
      createTool: () => new SearchWebTool(),
    });
    expect(() => renamed.getAvailableToolNames()).toThrow(/不得改写注册名称/);
    const failed = new ToolRegistry({
      strictInitialization: true,
      createTool: () => {
        throw new Error('Dependency unavailable');
      },
    });
    expect(() => failed.getAvailableToolNames()).toThrow(ToolRegistryInitializationError);
  });
});
