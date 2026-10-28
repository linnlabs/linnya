import { createProjectLifecycle } from 'src/domains/projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebSearchResultSchema,
  WorkspaceReadFileResultSchema,
  ToolOutputReadResultSchema,
} from '@app/schemas';
import {
  ObservationTruncationMeta,
  RunIdSchema,
  createToolOutputEvent,
  routeRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import type { ScriptedLlmTurn, ScriptedToolCall } from '@linnlabs/linnkit/testkit';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { attachCitationSourceResolver } from 'src/domains/citation';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createWorkspaceDocumentFile } from 'src/features/workspace/document-file-create';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from 'src/shared/utils/pathManager';
import { ToolOutputReadArgsSchema } from 'src/tools/tool_output/definitions/toolOutputRead';
import { toolRegistry } from '../../tools/toolRegistry';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../../document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { createCitationSourceResolver } from '../../tools/citation-source-resolution';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type { ConversationRealtimeEvent } from '../flow.schemas';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-read-continuation-'));
  setWorkspaceRoot(directory);
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture?.close();
  fixture = undefined;
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  resetWorkspaceRootToDefault();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function toolCall(id: string, name: string, args: Record<string, unknown>): ScriptedToolCall {
  return { id, name, argumentsJson: JSON.stringify(args) };
}

/** 只解开本次正式外层动态边界，不把存档正文中的历史 URI 或调用示例当作控制。 */
function archivedWindow(text: string, namespace: 'PREVIEW' | 'WINDOW'): string {
  const begin = text.match(
    new RegExp(`<<<BEGIN_UNTRUSTED_TOOL_OUTPUT_${namespace}_([0-9a-f]{16})>>>\\n`)
  );
  if (!begin) throw new Error('Missing archived window boundary');
  const body = text
    .split(begin[0])[1]
    ?.split(`\n<<<END_UNTRUSTED_TOOL_OUTPUT_${namespace}_${begin[1]}>>>`)[0];
  if (body === undefined) throw new Error('Missing archived window');
  return body;
}

async function seedCitedDocument(
  current: NonNullable<typeof fixture>,
  projectId: string
): Promise<void> {
  // 通过正式 producer facts + 文档写入端口构造自包含引用，下一会话只用 read_file 接纳。
  await current.eventStore.ensureConversation('source-seed', [], projectId, 'agent');
  const session = await current.eventStore.beginRunSession('source-seed', 'source-seed-run', {
    kind: 'agent',
  });
  const citations = [...'23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz']
    .slice(0, 40)
    .map((letter, index) => ({
      ref: `Abc23${letter}`,
      index: index + 1,
      sourceType: 'web',
      url: `https://example.com/source-${index}`,
      docTitle: `Source ${index}`,
      snippet: `Evidence${index}${'x'.repeat(500)}`,
    }));
  const source = WebSearchResultSchema.parse({
    data: {
      query: 'fixture',
      resultCount: citations.length,
      citations: { query: 'fixture', searchMode: 'web', citations },
      evidence_store: { bundle_id: '0123456789abcdef' },
      cacheStatus: 'miss',
    },
    observation: 'Synthetic acquisition for a saved source document.',
  });
  const sourceEvent = routeRuntimeEvent(
    createToolOutputEvent(
      'source-seed-event',
      'source-seed',
      'source-seed-turn',
      'web_search',
      'source-seed-call',
      { status: 'success', data: source.data, observation: source.observation }
    ),
    {
      run_id: RunIdSchema.parse('source-seed-run'),
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
  await current.eventStore.appendEventToRun(session, sourceEvent);
  const context: PluginToolContext = { conversationId: 'source-seed' };
  attachCitationSourceResolver(
    context,
    createCitationSourceResolver({
      events: [sourceEvent],
      async resolveEvidence() {
        throw new Error('The source fixture must bind every citation through its producer event.');
      },
    })
  );
  const created = await createWorkspaceDocumentFile({
    request: {
      projectId,
      parentPath: '/',
      name: 'report.md',
      content: [
        '# Synthetic report',
        citations.map(citation => `[@${citation.ref}]`).join(' '),
        'Historical example only: tool_output://0123456789abcdef is mentioned in the source.',
        ...Array.from({ length: 20 }, (_, index) => `Paragraph${index}${'z'.repeat(1_400)}`),
        'Final-source-marker',
      ].join('\n\n'),
    },
    resolveProvider: createWorkspaceDocumentFileCreateProviderResolver({
      db: current.db,
      context,
      workspaceService: new WorkspaceService(current.db),
    }),
  });
  expect(created).toBeDefined();
}

describe('file pagination and archived continuation through the actual next model request', () => {
  it.each(['text', 'document'] as const)(
    '%s：先补齐被截断返回，再读源下一页；引用与实时/重载事实不丢失',
    async view => {
      const first = toolCall(
        'source-0',
        'read_file',
        view === 'text'
          ? { locator: 'workspace:/report.md', limit: 35 }
          : { locator: 'workspace:/report.md', view: 'document', max_chars: 12_000 }
      );
      const deliveredSourceWindows: string[] = [];
      const deliveredToolText = new Map<string, string>();
      let joined = '';
      let expectedOffset = 0;
      // 只替换模型：它仅复制自己真实收到的续读提示，不从 owner data 或数据库找 cursor。
      const continuations: ScriptedLlmTurn[] = Array.from({ length: 30 }, (_, index) => {
        const turn: ScriptedLlmTurn = {
          assertCall(request) {
            const message = [...request.messages].reverse().find(item => item.role === 'tool');
            if (!message || message.role !== 'tool')
              throw new Error('Missing model-visible tool result');
            const text = message.content
              .flatMap(part => (part.type === 'text' ? [part.text] : []))
              .join('\n');
            deliveredToolText.set(message.tool_call_id, text);
            const isPreview = text.startsWith('【工具返回内容已截断');
            const isWindow = text.startsWith('【ToolOutputStore 读取结果】');
            if (isPreview) {
              joined = archivedWindow(text, 'PREVIEW');
              expectedOffset = joined.length;
              expect(text.length).toBeLessThanOrEqual(20_000);
              expect(text).not.toContain('文件下一页：');
              expect(text).not.toContain('文档下一页：');
            } else if (isWindow) {
              const window = archivedWindow(text, 'WINDOW');
              expect(text).toContain(`字符范围：[${expectedOffset},`);
              joined += window;
              expectedOffset += window.length;
            } else {
              joined = text;
            }
            const lastLine = text.slice(text.lastIndexOf('\n') + 1);
            const continuation =
              /^(?:补齐本次返回|继续这份存档文本)：tool_output_read\((\{.+\})\)/.exec(
                lastLine
              )?.[1];
            if (continuation) {
              const args = ToolOutputReadArgsSchema.parse(JSON.parse(continuation));
              expect(args.offset).toBe(expectedOffset);
              expect(continuation).not.toContain('limit');
              turn.toolCalls = [
                toolCall(`archive-${index}`, 'tool_output_read', JSON.parse(continuation)),
              ];
              return;
            }
            deliveredSourceWindows.push(joined);
            const sourceNext = /下一页：read_file\((\{.+\})\)\]$/.exec(joined)?.[1];
            if (sourceNext) {
              turn.toolCalls = [
                toolCall(`source-${index + 1}`, 'read_file', JSON.parse(sourceNext)),
              ];
            } else {
              turn.contentChunks = ['已读完所有返回窗口和源文件页。'];
            }
          },
        };
        return turn;
      });
      fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
        { toolCalls: [first] },
        ...continuations,
      ]);
      const projectId = createProjectLifecycle(fixture.db).create({ name: 'Read continuation' });
      await seedCitedDocument(fixture, projectId);
      const reader = toolRegistry.getTool('read_file');
      if (!reader) throw new Error('Missing actual reader');
      const read = reader.run.bind(reader);
      const ownerResults: ReturnType<typeof WorkspaceReadFileResultSchema.parse>[] = [];
      vi.spyOn(reader, 'run').mockImplementation(async (args, context) => {
        const output = await read(args, context);
        ownerResults.push(WorkspaceReadFileResultSchema.parse(JSON.parse(output)));
        return output;
      });
      const conversationId = `file-read-${view}`;
      await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
      const live: ConversationRealtimeEvent[] = [];
      await fixture.flow.next(
        {
          conversation_id: conversationId,
          project_id: projectId,
          new_events: [
            { type: 'user_input', content: '完整读取报告。', source: 'user', timestamp: 1 },
          ],
          options: {
            promptKey: 'default',
            model_id: 'scripted-test-model',
            project_metadata: { id: projectId, name: 'Read continuation' },
          },
        },
        event => {
          live.push(event);
        }
      );
      const events = (await fixture.eventStore.readEvents(conversationId, { limit: 200 })).events;
      const outputs = events.filter(event => event.type === 'tool_output');
      expect(outputs.every(output => output.status === 'success')).toBe(true);
      expect(ownerResults.length).toBeGreaterThan(1);
      expect(deliveredSourceWindows).toEqual(ownerResults.map(result => result.observation));
      expect(deliveredSourceWindows.join('')).toContain('Final-source-marker');
      const firstOwner = ownerResults[0];
      if (!firstOwner || !('citations' in firstOwner.data))
        throw new Error('Expected admitted citation facts');
      expect(firstOwner.data.citations?.citations).toHaveLength(40);
      const firstOutput = outputs.find(event => event.tool_call_id === 'source-0');
      expect(firstOutput?.data).toEqual(firstOwner.data);
      expect(firstOutput?.metadata?.observationTruncation).toBeDefined();
      expect(
        outputs.filter(event => event.tool_name === 'tool_output_read').length
      ).toBeGreaterThan(0);
      for (const output of outputs) {
        expect(deliveredToolText.get(output.tool_call_id)).toBe(output.observation);
        if (output.tool_name === 'tool_output_read') {
          ToolOutputReadResultSchema.parse({ data: output.data, observation: output.observation });
          expect(output.metadata?.observationTruncation).toBeUndefined();
        }
      }
      const reloaded = readTail(fixture.db, conversationId, 100);
      if (reloaded.status !== 'ready') throw new Error('Missing durable UI');
      const liveOutputs = live.filter(event => event.type === 'tool_output');
      expect(liveOutputs.map(event => event.observation)).toEqual(
        outputs.map(event => event.observation)
      );
      const uiTools = reloaded.messages.filter(message => message.message_type === 'tool_calls');
      expect(uiTools.map(message => message.content)).toEqual(
        outputs.map(event => event.observation)
      );
      expect(
        uiTools.find(message => message.payload.tool_call_id === 'source-0')?.payload
          .observation_truncation?.blobId
      ).toBe(ObservationTruncationMeta.parse(firstOutput?.metadata?.observationTruncation).blobId);
      expect((await fixture.runtime.supervisor.findByConversation(conversationId))[0]?.status).toBe(
        'completed'
      );
    }
  );

  it('错误 blob、旧行 cursor 和超预算 limit 在开始读取前拒绝，纠正说明进入模型及历史', async () => {
    const calls = [
      toolCall('bad-blob', 'tool_output_read', { blob_id: 'wrong' }),
      toolCall('old-cursor', 'tool_output_read', { blob_id: '0123456789abcdef', offset_line: 1 }),
      toolCall('bad-limit', 'tool_output_read', { blob_id: '0123456789abcdef', limit: 10_000 }),
    ];
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      { toolCalls: calls },
      { contentChunks: ['需要从当前返回复制正确的 blob 和字符 cursor。'] },
    ]);
    const projectId = createProjectLifecycle(fixture.db).create({ name: 'Read admission' });
    const conversationId = 'read-admission';
    await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    await fixture.flow.next(
      {
        conversation_id: conversationId,
        project_id: projectId,
        new_events: [{ type: 'user_input', content: '读取存档。', source: 'user', timestamp: 1 }],
        options: {
          promptKey: 'default',
          model_id: 'scripted-test-model',
          project_metadata: { id: projectId, name: 'Read admission' },
        },
      },
      () => {}
    );
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(events.filter(event => event.type === 'tool_process')).toHaveLength(0);
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(3);
    const delivered = fixture.ai.getCalls()[1]?.messages.filter(message => message.role === 'tool');
    for (const output of outputs) {
      // 框架 preflight 目前发布协议错误正文；结构化 error_code 只属于后续执行失败合同。
      expect(output.status).toBe('error');
      expect(output.observation).toContain('[TOOL_OUTPUT_READ_ARGUMENTS_INVALID]');
      expect(output.observation).toContain('字符，不是行');
      expect(
        delivered?.find(message => message.tool_call_id === output.tool_call_id)?.content
      ).toEqual([{ type: 'text', text: output.observation }]);
    }
    fixture.ai.assertAllTurnsConsumed();
  });
});
