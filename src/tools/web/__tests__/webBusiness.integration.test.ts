import { DeepWebSearchResultSchema } from '@app/schemas';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { createChildRunHarness } from 'src/app-hosts/linnya/testkit/agent-harness/childRunHarness';
import { DEEP_WEB_SEARCH_DEFINITION } from 'src/app-hosts/linnya/agent-registry/agents/deep_web_search';
import { SearchWebTool } from '../websearch/SearchWebTool';
import { AssembleWebSourcesTool } from '../websearch/deep/AssembleWebSourcesTool';
import { decorateDeepWebSnapshotToolContext } from 'src/app-hosts/linnya/adapters/tools/deepWebSnapshotToolContextDecorator';
import { allocateCitationRefFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { PromptKeys } from '@app/schemas';
import { runtimeKernel } from '@linnlabs/linnkit';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { createGraphLoopHarness, createScriptedInferenceHarness } from '@linnlabs/linnkit/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebSearchServiceRequest } from '../websearch/definitions/webSearchService';
import type { WebReadServiceRequest } from '../webread/definitions/webReadService';
import {
  pathManager,
  setWorkspaceRoot,
  resetWorkspaceRootToDefault,
} from '../../../shared/utils/pathManager';
import { resolveEvidenceFromBundles } from '../../../domains/evidence';
import type { ToolContext } from '../../types';
import { BaiduQianfanProvider } from '../websearch/providers/baiduQianfan';
import { MetasoReaderProvider } from '../webread/providers/metaso';
import { installWebReadConfigReader } from '../webread/ports/webReadConfigReader';
import { WebSearchTool } from '../websearch/WebSearchTool';
import { WebReadTool } from '../webread/WebReadTool';
import {
  UNTRUSTED_FAILURE_TEXT,
  WebUpstreamFixtureServer,
} from './fixtures/webUpstreamFixtureServer';
import { WebFailureError } from '../shared/webFailure';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';
import { decorateWebEvidenceWriterToolContext } from '../../../app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator';
import { ToolRegistry } from '../../../app-hosts/linnya/adapters/tools/toolRegistry';
import * as builtinPluginRegistry from '../../../app-hosts/linnya/plugin-registry/builtin';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { defaultObservationPreviewPort } from '../../../app-hosts/linnya/adapters/tools/defaultPorts';
import { createDefaultLlmNode } from '../../../app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import {
  createScriptedChatModelCatalog,
  SCRIPTED_MODEL_ID,
} from '../../../app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import { Logger } from '../../../shared/logger';

const createSearchProviderMock = vi.hoisted(() => vi.fn());
const createLocalReadProviderMock = vi.hoisted(() => vi.fn());
const createLocalRenderProviderMock = vi.hoisted(() => vi.fn());
const createReadProviderMock = vi.hoisted(() => vi.fn());

vi.mock('../websearch/providers/factory', () => ({
  createWebSearchProvider: createSearchProviderMock,
}));
vi.mock('../webread/providers/factory', () => ({
  createLocalWebReadProvider: createLocalReadProviderMock,
  createLocalRenderWebReadProvider: createLocalRenderProviderMock,
  createWebReadProvider: createReadProviderMock,
}));

function createSearchService(params: {
  serviceId: 'baidu_qianfan';
  apiBase: string;
}): WebSearchServiceRequest {
  return {
    serviceId: params.serviceId,
    baseUrl: params.apiBase,
    apiKey: 'fixture-key',
  };
}

function createReadService(baseUrl: string): WebReadServiceRequest {
  return {
    serviceId: 'metaso_reader',
    baseUrl,
    apiKey: 'fixture-key',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) throw new Error(`测试结果缺少对象字段 ${key}`);
  return value[key];
}

function readString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string')
    throw new Error(`测试结果缺少字符串字段 ${key}`);
  return value[key];
}

describe('Web Phase 1 本地优先读取业务 E2E', () => {
  const fixture = new WebUpstreamFixtureServer();
  let tempRoot = '';
  let uninstallWebReadConfigReader: (() => void) | undefined;

  beforeAll(async () => fixture.start());

  afterAll(async () => fixture.stop());

  afterEach(async () => {
    uninstallWebReadConfigReader?.();
    uninstallWebReadConfigReader = undefined;
    vi.clearAllMocks();
    vi.restoreAllMocks();
    clearPluginRuntimeStateForTests();
    fixture.reset();
    resetWorkspaceRootToDefault();
    if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  });

  async function prepareBusinessContext(): Promise<ToolContext> {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya_web_business_'));
    setWorkspaceRoot(tempRoot);
    const searchProvider = new BaiduQianfanProvider(
      createSearchService({
        serviceId: 'baidu_qianfan',
        apiBase: `${fixture.baseUrl}/v2`,
      })
    );
    const readProvider = new MetasoReaderProvider(createReadService(`${fixture.baseUrl}/api/v1`));
    createSearchProviderMock.mockReturnValue(searchProvider);
    createLocalReadProviderMock.mockReturnValue({
      name: 'local_http',
      read: vi
        .fn()
        .mockRejectedValue(new WebFailureError('js_required', 'fixture requires managed reader')),
    });
    createLocalRenderProviderMock.mockReturnValue({
      name: 'local_render',
      read: vi
        .fn()
        .mockRejectedValue(new WebFailureError('provider_error', 'fixture render unavailable')),
    });
    createReadProviderMock.mockReturnValue(readProvider);
    uninstallWebReadConfigReader = installWebReadConfigReader({
      read: () => ({ renderEnabled: true, managedReader: 'metaso_reader' }),
      readSettings: () => ({ renderEnabled: true, managedReader: 'metaso_reader', slots: {} }),
    });
    const context: ToolContext = {
      conversationId: 'web_e2e_conversation',
      turnId: 'web_e2e_turn',
      research: { instanceId: 'web_e2e_instance' },
    };
    attachCitationSequence(context, { offset: 4 });
    attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
    decorateWebEvidenceWriterToolContext(context);
    return context;
  }

  it('网页 child 多查询 → 实际 HTTP 读取 → Evidence 摘录组装，并继承父模型', async () => {
    await prepareBusinessContext();
    const allocator = createCitationRefAllocatorFixture();
    const decorate = (context: ToolContext) => {
      attachCitationSequence(context, { offset: 0 });
      attachCitationRefAllocator(context, allocator);
      decorateWebEvidenceWriterToolContext(context);
    };
    class Search extends SearchWebTool {
      override async run(args: Record<string, unknown>, context: ToolContext) {
        decorate(context);
        return super.run(args, context);
      }
    }
    class Read extends WebReadTool {
      override async run(args: Record<string, unknown>, context: ToolContext) {
        decorate(context);
        return super.run(args, context);
      }
    }
    class Assemble extends AssembleWebSourcesTool {
      override async run(args: Record<string, unknown>, context: ToolContext) {
        decorateWebEvidenceWriterToolContext(context);
        decorateDeepWebSnapshotToolContext(context);
        return super.run(args, context);
      }
    }
    const ref = allocateCitationRefFixture({
      sourceType: 'web',
      url: 'https://example.com/article',
    });
    // 本夹具只测真实 Graph / 工具 / HTTP / Evidence；持久限额由 SQLite admission 集成测试覆盖。
    if (!DEEP_WEB_SEARCH_DEFINITION.config) throw new Error('Missing child config');
    const config = { ...DEEP_WEB_SEARCH_DEFINITION.config, maxCallsPerParentRun: undefined };
    const harness = createChildRunHarness({
      agentDefinitions: [{ ...DEEP_WEB_SEARCH_DEFINITION, config }],
      tools: [new Search(), new Read(), new Assemble()],
      turns: [
        {
          toolCalls: [
            {
              id: 'forbidden-recursion',
              name: 'web_search',
              argumentsJson: JSON.stringify({ query: 'recursive attempt', deep_search: true }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'search-1',
              name: 'search_web',
              argumentsJson: JSON.stringify({ query: 'mechanism evidence' }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'search-2',
              name: 'search_web',
              argumentsJson: JSON.stringify({ query: 'opposing mechanism' }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'read-1',
              name: 'web_read',
              argumentsJson: JSON.stringify({ url: 'https://example.com/article' }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'assemble-1',
              name: 'assemble_web_sources',
              argumentsJson: JSON.stringify({
                selected: [{ ref, purpose: 'A test source' }],
                summary: 'Fixture sources',
                gaps: ['Only a fixture'],
                conflicts: [],
              }),
            },
          ],
        },
      ],
    });
    try {
      const context = createToolContextFixture({
        conversationId: 'deep-web-conversation',
        turnId: 'parent-turn',
        patch: {
          modelId: SCRIPTED_MODEL_ID,
          runId: RunIdSchema.parse('parent-web-run'),
          parentToolCallId: 'parent-search-call',
          createSubRunTracePublisher: () => ({ publish: vi.fn() }),
          registeredChildRunInvoker: harness.invoker,
        },
      });
      attachCitationSequence(context, { offset: 4 });
      const result = DeepWebSearchResultSchema.parse(
        JSON.parse(
          await new WebSearchTool().run({ query: 'Research materials', deep_search: true }, context)
        )
      );
      expect(result.data.research).toMatchObject({ search_count: 2, read_attempt_count: 1 });
      expect(result.data.research?.source_notes[0]).toMatchObject({
        capture_kind: 'page_content',
        source_call_id: 'read-1',
        ref,
      });
      expect(result.data.citations.citations[0]).toMatchObject({ ref, index: 5 });
      expect(result.data.subrun_ids).toHaveLength(1);
      expect(harness.getToolExecutions().map(x => x.toolName)).toEqual([
        'search_web',
        'search_web',
        'web_read',
        'assemble_web_sources',
      ]);
      expect(harness.getToolExecutions().every(x => x.context.modelId === SCRIPTED_MODEL_ID)).toBe(
        true
      );
      harness.assertAllTurnsConsumed();
    } finally {
      harness.restore();
    }
  });

  it('搜索 → 去重引用 → 读取正文 → 两类 Evidence 均可回放', async () => {
    const context = await prepareBusinessContext();
    const searchRaw = await new WebSearchTool().run(
      { query: '联网搜索本地夹具', top_k: 6, recency_days: 30 },
      context
    );
    const searchResult: unknown = JSON.parse(searchRaw);
    const searchData = readRecord(searchResult, 'data');
    const citationMetadata = readRecord(searchData, 'citations');
    const citations = citationMetadata['citations'];
    if (!Array.isArray(citations)) throw new Error('搜索结果缺少 citations 数组');

    expect(searchData['resultCount']).toBe(3);
    expect(citations.map(item => (isRecord(item) ? item['index'] : undefined))).toEqual([5, 6, 7]);
    const refs = citations.map(item => readString(item, 'ref'));
    expect(new Set(refs).size).toBe(3);
    const firstUrl = readString(citations[0], 'url');
    expect(firstUrl).toBe('https://example.com/article');
    expect(searchRaw).toContain(`[@${refs[0]}]`);

    const request = fixture.latestSearchRequest;
    expect(isRecord(request) ? request['search_recency_filter'] : undefined).toBe('month');

    const searchEvidence = await resolveEvidenceFromBundles({
      conversationId: 'web_e2e_conversation',
      instanceId: 'web_e2e_instance',
      refs,
      max_units: 100,
      max_chars: 10_000,
    });
    expect(searchEvidence.missing_refs).toEqual([]);
    expect(searchEvidence.resolved[refs[0]]?.text).toContain('本地夹具文章搜索摘要');

    const readRaw = await new WebReadTool().run({ url: firstUrl, max_chars: 10_000 }, context);
    const readResult: unknown = JSON.parse(readRaw);
    const readData = readRecord(readResult, 'data');
    expect(readData['url']).toBe(firstUrl);
    expect(readData['title']).toBe('Fixture Article');
    expect(readData).not.toHaveProperty('contentText');
    expect(readData['provider']).toBe('metaso_reader');
    expect(readData['renderMode']).toBe('managed');
    expect(readData['escalated']).toBe(true);
    expect(readData['escalationReason']).toBe('js_required');
    expect(createLocalReadProviderMock).toHaveBeenCalledTimes(1);
    expect(createReadProviderMock).toHaveBeenCalledTimes(1);

    const readCitations = readRecord(readData, 'citations')['citations'];
    if (!Array.isArray(readCitations) || readCitations.length !== 1)
      throw new Error('读取结果应有一条 citation');
    const pageRef = readString(readCitations[0], 'ref');
    expect(pageRef).toBe(refs[0]);
    const allEvidence = await resolveEvidenceFromBundles({
      conversationId: 'web_e2e_conversation',
      instanceId: 'web_e2e_instance',
      refs: [...refs, pageRef],
      max_units: 100,
      max_chars: 20_000,
    });
    expect(allEvidence.missing_refs).toEqual([]);
    expect(allEvidence.resolved[pageRef]?.text).toContain('本地真实 HTTP 上游');
    expect(allEvidence.resolved[pageRef]?.text).toContain('Second paragraph for evidence replay');
    expect(allEvidence.resolved[pageRef]?.capture_kind).toBe('web_page');
  });

  it.each([
    ['rate_limit', 'rate_limited'],
    ['server_error', 'http_5xx'],
    ['malformed', 'invalid_response'],
  ] as const)('搜索上游 %s 时保留稳定失败分类且不写成功 Evidence', async (scenario, kind) => {
    const context = await prepareBusinessContext();
    fixture.searchScenario = scenario;

    await expect(new WebSearchTool().run({ query: 'failure case' }, context)).rejects.toMatchObject(
      { kind }
    );
    const bundlesDir = pathManager.getConversationEvidenceBundlesDir({
      conversationId: 'web_e2e_conversation',
      instanceId: 'web_e2e_instance',
    });
    const bundleFiles = await fsp.readdir(bundlesDir).catch(() => []);
    expect(bundleFiles).toEqual([]);
  });

  it('调用方取消会贯穿 tool → provider → adapter → fetch', async () => {
    const context = await prepareBusinessContext();
    fixture.searchScenario = 'delayed';
    const controller = new AbortController();
    const abortedContext: ToolContext = { ...context, abortSignal: controller.signal };
    attachCitationSequence(abortedContext, { offset: 4 });
    attachCitationRefAllocator(abortedContext, createCitationRefAllocatorFixture());
    const promise = new WebSearchTool().run({ query: 'cancel case' }, abortedContext);
    setTimeout(() => controller.abort(), 30);

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it.each([
    ['unauthorized', 'web_search', 'auth', 401],
    ['forbidden', 'web_search', 'http_403', 403],
    ['blocked_managed_disabled', 'web_read', 'captcha', 403],
  ] as const)('%s 失败经正式注册入口和图执行后，不污染模型、事件或诊断', async (scenario, toolName, code, status) => {
    const context = await prepareBusinessContext();
    if (scenario === 'blocked_managed_disabled') {
      createLocalReadProviderMock.mockReturnValue({
        name: 'local_http', async read() { throw new WebFailureError('captcha', 'HTTP 403'); },
      });
      uninstallWebReadConfigReader?.();
      uninstallWebReadConfigReader = installWebReadConfigReader({
        read: () => ({ renderEnabled: false, managedReader: 'none' }),
        readSettings: () => ({ renderEnabled: false, managedReader: 'none', slots: {} }),
      });
      context.webReadAccessHistory = { read: () => ({ blocked: 2, succeeded: 0, unclassified: 1 }) };
    } else fixture.searchScenario = scenario;
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolClasses').mockReturnValue([WebSearchTool, WebReadTool]);
    vi.spyOn(builtinPluginRegistry, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const execution = vi.spyOn(registry, 'executeTool');
    const diagnostic = vi.spyOn(Logger.prototype, 'error');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auditPort = { emit: vi.fn() };
    const conversationId = 'web_e2e_conversation';
    const turnId = 'web_e2e_turn';
    const query = '请搜索夹具页面并说明结果';
    const modelCatalog = createScriptedChatModelCatalog();
    const modelResolver = new runtimeKernel.llm.ModelResolver({ modelCatalog });
    const ai = createScriptedInferenceHarness([
      { toolCalls: [{ id: 'call_web_failure', name: toolName, argumentsJson: JSON.stringify(toolName === 'web_search' ? { query: 'failure case' } : { url: 'https://example.com/blocked' }) }] },
      { contentChunks: ['搜索失败，未获得可引用的内容。'] },
    ], { modelCatalog });
    const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
    const bus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
    const publisher = new runtimeKernel.execution.RuntimeEventPublisher(bus, sequencer, {
      run_id: RunIdSchema.parse(turnId), lane: 'foreground', visibility: 'conversation',
    });

    // 使用 npm 框架与真实 Host registry，不在测试替身中重新实现错误码转交。
    await createGraphLoopHarness({
      conversationId, turnId, query, toolContext: context,
      request: {
        query, promptKey: PromptKeys.DEFAULT, model_id: SCRIPTED_MODEL_ID,
        maxSteps: 4, enableTools: true, availableTools: [toolName],
      },
      llmCaller: ai.getLlmCaller(), toolRuntime: registry,
      observationPreview: defaultObservationPreviewPort, auditPort,
      createLlmNode: ({ llmCaller, toolRuntime }) => createDefaultLlmNode({
        llmCaller, toolRuntime, modelCatalog, modelResolver, auditPort,
      }),
      runtimeEventSink: (event, source) => publisher.publish(event, source),
    }).run();

    ai.assertAllTurnsConsumed();
    expect(execution).toHaveBeenCalledTimes(1);
    await expect(execution.mock.results[0]?.value).resolves.toMatchObject({
      success: false, errorKind: 'execution', errorCode: code,
      error: expect.stringContaining(scenario === 'blocked_managed_disabled' ? 'captcha' : `HTTP ${status}`),
    });
    const events = publisher.getGeneratedEvents();
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ status: 'error', error_code: code });
    expect(outputs[0]?.ephemeral).not.toBe(true);
    if (scenario === 'blocked_managed_disabled') {
      expect(outputs[0]?.observation).toContain('访问拦截 3 次');
      expect(outputs[0]?.observation).toContain('1 次历史失败');
    }
    const nextInput = ai.getCalls()[1]?.messages;
    expect(JSON.stringify(nextInput)).toContain(scenario === 'blocked_managed_disabled' ? 'captcha' : `HTTP ${status}`);
    expect(diagnostic).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(auditPort.emit).toHaveBeenCalled();
    for (const boundary of [nextInput, events, diagnostic.mock.calls, consoleError.mock.calls, auditPort.emit.mock.calls]) {
      expect(inspect(boundary, { depth: null })).not.toContain(UNTRUSTED_FAILURE_TEXT);
    }
    expect(createReadProviderMock).not.toHaveBeenCalled();
    const bundlesDir = pathManager.getConversationEvidenceBundlesDir({
      conversationId, instanceId: 'web_e2e_instance',
    });
    expect(await fsp.readdir(bundlesDir).catch(() => [])).toEqual([]);
  });

  it('搜索 HTTP 200 业务错误的嵌套 cause 不携带上游自由文本', async () => {
    const context = await prepareBusinessContext();
    fixture.searchScenario = 'business_error';
    const error = await new WebSearchTool().run({ query: 'business error' }, context)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(inspect(error, { depth: null })).not.toContain(UNTRUSTED_FAILURE_TEXT);
  });
});
