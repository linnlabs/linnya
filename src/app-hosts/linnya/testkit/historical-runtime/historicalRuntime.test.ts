import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrozenCorpusSchema, digest } from './definitions/historicalCorpus';
import { createHistoricalWebProviders } from './functions/createHistoricalWebProviders';
import { calculate } from './functions/calculate';
import { createHistoricalToolEnvironment } from './orchestration/createHistoricalToolEnvironment';
import * as builtin from '../../plugin-registry/builtin';
import { WebSearchTool } from 'src/tools/web/websearch/WebSearchTool';
import { SearchWebTool } from 'src/tools/web/websearch/SearchWebTool';
import { WebReadTool } from 'src/tools/web/webread/WebReadTool';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { attachWebEvidenceWriter } from 'src/tools/web/shared/orchestration/webEvidenceWriterContext';
import type { ToolContext } from 'src/tools/types';
import { PromptKeys } from '@app/schemas';
import { audit, execution, llm, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  createScriptedInferenceHarness,
  createToolContextFixture,
} from '@linnlabs/linnkit/testkit';
import { createLinnyaChildRunInvoker } from '../../adapters/child-runs/childRunInvokerFactory';
import { createToolImageModelCatalog } from '../agent-harness/toolImageIntegrationFixtures';
import { ShellTool } from 'src/tools/commands/shell/ShellTool';
import { createDefaultGraphAgentExecutor } from '../../adapters/runtime-assembly/graphRuntimeFactory';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../plugin-registry/pluginRuntimeState';
import { clearRegisteredAgentTaskCache } from '../../agent-registry/agentTaskResolver';

const body = 'Primary historical evidence with a June definition and revenue table.';
const input = {
  schemaVersion: 1,
  corpusId: 'synthetic-v1',
  cutoffExclusive: '2026-09-01T00:00:00Z',
  documents: [
    {
      id: 'source',
      url: 'https://example.com/report.pdf',
      title: 'June report',
      availableAt: '2026-08-02T00:00:00Z',
      originalSha256: '0'.repeat(64),
      projectionSha256: digest(body),
      text: body,
    },
  ],
};
const corpus = () => FrozenCorpusSchema.parse(input);
afterEach(() => {
  vi.restoreAllMocks();
  clearRegisteredAgentTaskCache();
  clearPluginRuntimeStateForTests();
});

describe('historical experiment isolation', () => {
  it('rejects changed text, future availability and operator-only fields before creating tools', () => {
    expect(() => FrozenCorpusSchema.parse({ ...input, settlement: 'future answer' })).toThrow();
    for (const patch of [{ text: 'changed' }, { availableAt: input.cutoffExclusive }])
      expect(() =>
        FrozenCorpusSchema.parse({ ...input, documents: [{ ...input.documents[0], ...patch }] })
      ).toThrow();
  });

  it('searches only frozen text and refuses every unknown URL without network', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network allowed'));
    const providers = createHistoricalWebProviders(corpus());
    expect(await providers.search.search({ query: 'June revenue' })).toHaveLength(1);
    expect(await providers.search.search({ query: 'unknownword' })).toEqual([]);
    expect((await providers.read.read({ url: input.documents[0].url })).content).toBe(body);
    await expect(providers.read.read({ url: 'https://example.com/september' })).rejects.toThrow(
      'HISTORICAL_SOURCE_UNAVAILABLE'
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('preserves formal citations/evidence for both search entries and frozen PDF text', async () => {
    vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([
      WebSearchTool,
      SearchWebTool,
      WebReadTool,
    ]);
    vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const environment = createHistoricalToolEnvironment(corpus());
    const context: ToolContext = {
      conversationId: 'frozen-test',
      turnId: 'turn-test',
      registeredRootAllowedTools: ['web_search', 'search_web', 'web_read'],
    };
    attachCitationSequence(context, { offset: 0 });
    attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
    const save = vi.fn().mockResolvedValue({ bundleId: '0123456789abcdef' });
    attachWebEvidenceWriter(context, { save });
    for (const name of ['web_search', 'search_web', 'web_read']) {
      const result = await environment.toolRuntime.executeTool(
        name,
        name === 'web_read' ? { url: input.documents[0].url } : { query: 'June' },
        context
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.result).toContain('June');
    }
    expect(save).toHaveBeenCalled();
    expect(JSON.stringify(save.mock.calls)).toContain('web_page');
    expect(JSON.stringify(save.mock.calls)).not.toContain('future answer');
  });

  it('denies physical files, Knowledge, Shell and unknown tools before owner execution, including child contexts', async () => {
    const environment = createHistoricalToolEnvironment(corpus());
    const contexts: ToolContext[] = [
      { conversationId: 'root', registeredRootAllowedTools: ['shell'] },
      { conversationId: 'child', registeredChildAllowedTools: ['shell'] },
    ];
    for (const context of contexts) {
      for (const [name, args] of [
        ['shell', { command: 'curl https://example.com/future' }],
        ['knowledge_search', { query: 'future' }],
        ['read_file', { locator: 'file:///tmp/settlement.txt' }],
        ['read_file', { locator: 'conversation:/../../settlement.txt' }],
        ['skill', { skill_name: 'future-answers' }],
        ['unregistered', {}],
      ] as const)
        expect(await environment.toolRuntime.executeTool(name, args, context)).toMatchObject({
          success: false,
          error: expect.stringContaining('HISTORICAL_TOOL_DENIED'),
        });
    }
    await expect(
      environment.physicalFileReader.readFile({
        absolutePath: '/tmp/answer',
        scope: { kind: 'host' },
      })
    ).rejects.toThrow('HISTORICAL_TOOL_DENIED');
  });

  it('executes finite calculations only for roots/children that originally possessed Shell', async () => {
    const environment = createHistoricalToolEnvironment(corpus());
    const args = { operation: 'growth_percent', values: [110, 100] };
    const root: ToolContext = { conversationId: 'root', registeredRootAllowedTools: ['shell'] };
    const child: ToolContext = {
      conversationId: 'child',
      registeredChildAllowedTools: ['search_web'],
    };
    expect(await environment.toolRuntime.executeTool('calculate', args, root)).toMatchObject({
      success: true,
    });
    expect(await environment.toolRuntime.executeTool('calculate', args, child)).toMatchObject({
      success: false,
    });
    expect(calculate({ operation: 'quantile', values: [1, 2, 3, 4], probability: 0.25 })).toBe(
      1.75
    );
    expect(() => calculate({ operation: 'divide', values: [1, 0] })).toThrow();
    expect(() => calculate({ operation: 'add', values: [1], code: 'process.env' })).toThrow();
  });

  it('passes the same restricted schemas through child inference, preserving calculation only in eligible roles', async () => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    clearRegisteredAgentTaskCache();
    vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([
      WebSearchTool,
      SearchWebTool,
      WebReadTool,
      ShellTool,
    ]);
    vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const environment = createHistoricalToolEnvironment(corpus());
    const rootCatalog = createToolImageModelCatalog('historical-root-fixture');
    const rootAi = createScriptedInferenceHarness([{ contentChunks: ['Done.'] }], {
      modelCatalog: rootCatalog,
    });
    const executor = createDefaultGraphAgentExecutor({
      modelCatalog: rootCatalog,
      modelResolver: new llm.ModelResolver({ modelCatalog: rootCatalog }),
      llmCaller: rootAi.getLlmCaller(),
      ...environment,
    });
    await executor.tick({
      request: {
        model_id: 'historical-root-fixture',
        promptKey: PromptKeys.DEFAULT,
        query: 'Describe the admitted tools.',
        enableTools: true,
        availableTools: ['shell', 'web_read'],
      },
      history: [],
      toolContext: createToolContextFixture({ conversationId: 'historical-root-fixture' }),
    });
    expect(rootAi.getCalls()[0]?.options.tools?.map(tool => tool.name)).toEqual([
      'web_read',
      'calculate',
    ]);
    rootAi.assertAllTurnsConsumed();
    for (const availableTools of [
      ['shell', 'web_read'],
      ['search_web', 'web_read'],
    ]) {
      const modelId = 'historical-schema-fixture';
      const modelCatalog = createToolImageModelCatalog(modelId);
      const ai = createScriptedInferenceHarness(
        availableTools.includes('shell')
          ? [
              {
                toolCalls: [
                  {
                    id: 'calculate-fixture',
                    name: 'calculate',
                    argumentsJson: '{"operation":"growth_percent","values":[110,100]}',
                  },
                ],
              },
              { contentChunks: ['Done.'] },
            ]
          : [{ contentChunks: ['Done.'] }],
        { modelCatalog }
      );
      const sequencer = new execution.EventSequencer('historical-fixture');
      const bus = new execution.EventBus(sequencer.getExecutionId());
      const publisher = new execution.RuntimeEventPublisher(bus, sequencer, {
        run_id: RunIdSchema.parse('historical-fixture-run'),
        lane: 'child',
        visibility: 'parent-trace',
      });
      const invoker = createLinnyaChildRunInvoker({
        telemetryPort: telemetry.noopTelemetry,
        auditPort: audit.noopAudit,
        modelCatalog,
        modelResolver: new llm.ModelResolver({ modelCatalog }),
        llmCaller: ai.getLlmCaller(),
        ...environment,
        observationPreview: {
          async truncateObservation(params) {
            return { truncated: false, preview: params.text };
          },
        },
      });
      const result = await invoker.invoke({
        agentConfig: {
          id: 'historical-fixture-child',
          promptKey: PromptKeys.DEFAULT,
          availableTools,
          modelPolicy: { kind: 'fixed', modelId },
        },
        userMessage: 'Describe the admitted tools.',
        conversationId: 'historical-fixture-child',
        // 正式 RegisteredSubagentInvoker 会设置 child 名单；此处直接测下层 invoker，要传入相同已接纳事实。
        parentToolContext: createToolContextFixture({
          conversationId: 'historical-fixture-child',
          patch: { registeredChildAllowedTools: availableTools },
        }),
        runtimeEventSink: (event, source) => publisher.publish(event, source),
      });
      expect(result.success).toBe(true);
      const names = ai.getCalls()[0]?.options.tools?.map(tool => tool.name);
      expect(names).toContain('web_read');
      expect(names).not.toContain('shell');
      expect(names).not.toContain('knowledge_search');
      expect(names?.includes('calculate')).toBe(availableTools.includes('shell'));
      if (availableTools.includes('shell'))
        expect(ai.getCalls()[1]?.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: expect.stringContaining('Executed calculation:'),
                }),
              ]),
            }),
          ])
        );
      ai.assertAllTurnsConsumed();
    }
  });
});
