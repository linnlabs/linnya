import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceEditFileResultSchema, WorkspaceWriteFileResultSchema } from '@app/schemas';
import { MarkdownDocumentService } from 'src/domains/markdown';
import type { ScriptedToolCall } from '@linnlabs/linnkit/testkit';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
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
  directory = mkdtempSync(join(tmpdir(), 'linnya-edit-feedback-'));
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
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function call(id: string, name: string, args: Record<string, unknown>): ScriptedToolCall {
  return { id, name, argumentsJson: JSON.stringify({ locator: 'workspace:/report.md', ...args }) };
}

describe('file edit feedback through durable Flow and the next model request', () => {
  it('规范化等价编辑说明本次无变化，不把已有 pending 当作新修改', async () => {
    const calls = [
      call('create', 'write_file', { content: '原值 (口径)\n' }),
      call('first-edit', 'edit_file', { old_string: '原值', new_string: '修订值' }),
      call('before-equivalent', 'read_file', {}),
      call('equivalent', 'edit_file', {
        old_string: '(口径)', new_string: '\\(口径\\)',
      }),
      call('after-equivalent', 'read_file', {}),
      call('real-edit', 'edit_file', { old_string: '修订值', new_string: '最终值' }),
      call('after-real-edit', 'read_file', {}),
      call('restore', 'edit_file', { old_string: '最终值', new_string: '原值' }),
      call('annotate', 'write_file', { content: '原值 (口径)\n\n<!-- 核对依据 -->' }),
    ];
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      ...calls.map(tool => ({ toolCalls: [tool] })),
      { contentChunks: ['已核对真实修订与规范化等价请求。'] },
    ]);
    const store = new MarkdownDocumentService(fixture.db);
    const pending = new Map<string, ReturnType<MarkdownDocumentService['getPendingRevisions']>>();
    let documentId: string | undefined;
    const live: ConversationRealtimeEvent[] = [];
    const conversationId = 'normalized-edit-feedback';
    const projectId = new WorkspaceService(fixture.db).createProject('Normalized edit feedback');
    await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    await fixture.flow.next({
      conversation_id: conversationId,
      project_id: projectId,
      new_events: [{ type: 'user_input', content: '编辑并核对报告。', source: 'user', timestamp: 1 }],
      options: {
        promptKey: 'default', model_id: 'scripted-test-model',
        project_metadata: { id: projectId, name: 'Normalized edit feedback' },
      },
    }, event => {
      live.push(event);
      if (event.type !== 'tool_output') return;
      if (event.tool_call_id === 'create') {
        documentId = WorkspaceWriteFileResultSchema.parse({
          data: event.data, observation: event.observation,
        }).data.documentId;
      }
      if (documentId) pending.set(event.tool_call_id, store.getPendingRevisions(documentId));
    });

    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs.map(event => [event.tool_call_id, event.status])).toEqual(
      calls.map(tool => [tool.id, 'success'])
    );
    const output = (id: string) => {
      const event = outputs.find(item => item.tool_call_id === id);
      if (!event) throw new Error(`Missing tool result: ${id}`);
      return event;
    };
    // 同一 canonical current 和完整 pending 身份均保持不变，而非只比较 pending 数量。
    expect(output('before-equivalent').observation).toContain('修订值 (口径)');
    expect(output('after-equivalent').observation).toEqual(output('before-equivalent').observation);
    expect(pending.get('first-edit')).toHaveLength(1);
    expect(pending.get('equivalent')).toEqual(pending.get('first-edit'));
    const equivalent = WorkspaceEditFileResultSchema.parse({
      data: output('equivalent').data, observation: output('equivalent').observation,
    });
    expect(equivalent.data.replaced).toBe(1);
    expect(equivalent.observation).toContain('本次规范化后正文和批注无变化');
    expect(equivalent.observation).toContain('正文修订 1 块待确认');
    expect(equivalent.data.text_metrics).toEqual({ characters: 8, han_characters: 5 });
    expect(equivalent.observation).toContain('当前全文（含待确认修订）：8 字符');

    expect(pending.get('real-edit')).toHaveLength(1);
    expect(pending.get('real-edit')?.[0]?.revision).toBe(
      (pending.get('first-edit')?.[0]?.revision ?? 0) + 1
    );
    expect(output('after-real-edit').observation).toContain('最终值 (口径)');
    expect(pending.get('restore')).toEqual([]);
    expect(output('restore').observation).toContain('已撤回 1 块正文修订');
    expect(pending.get('annotate')).toEqual([]);
    expect(output('annotate').observation).toContain('批注 1 条已创建');
    for (const id of ['first-edit', 'real-edit', 'restore', 'annotate']) {
      expect(output(id).observation).not.toContain('无变化');
    }

    fixture.ai.assertAllTurnsConsumed();
    const nextRequest = fixture.ai.getCalls()[4];
    expect(nextRequest?.messages.find(message =>
      message.role === 'tool' && message.tool_call_id === 'equivalent'
    )).toMatchObject({ content: [{ type: 'text', text: equivalent.observation }] });
    expect(live.find(event => event.type === 'tool_output' && event.tool_call_id === 'equivalent'))
      .toMatchObject({ observation: equivalent.observation });
    const reloaded = readTail(fixture.db, conversationId, 100);
    if (reloaded.status !== 'ready') throw new Error('Expected durable UI window');
    expect(reloaded.messages.find(message =>
      message.message_type === 'tool_calls' && message.payload.tool_call_id === 'equivalent'
    )).toMatchObject({ content: equivalent.observation });
  });

  it.each([10, 11, 12])('同批 %i 次真实写入及混合编辑结果完整进入下一模型请求', async count => {
    // 每个调用操作独立文档，避免把文件写入互相依赖混入批次回执的验证。
    const documents = Array.from({ length: count }, (_, index) => ({
      locator: `workspace:/report-${index}.md`,
      original: `条目${index}的值是10。`,
      replacement: `条目${index}的值是12。`,
    }));
    const writes = documents.map((document, index) =>
      call(`create-${index}`, 'write_file', {
        locator: document.locator,
        content: `# 报告${index}\n\n${document.original}\n`,
      })
    );
    const edits = documents.map((document, index) =>
      call(`edit-${index}`, 'edit_file', {
        locator: document.locator,
        old_string: index < count - 2 ? document.original : '不存在的旧段落。',
        new_string: document.replacement,
      })
    );
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      { toolCalls: writes },
      { toolCalls: edits },
      { contentChunks: ['编辑已执行，最后两项原文未命中。'] },
    ]);
    const conversationId = `file-edit-batch-${count}`;
    const projectId = new WorkspaceService(fixture.db).createProject('Batch feedback');
    await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    const live: ConversationRealtimeEvent[] = [];
    await fixture.flow.next(
      {
        conversation_id: conversationId,
        project_id: projectId,
        new_events: [
          { type: 'user_input', content: '批量保存并修改报告。', source: 'user', timestamp: 1 },
        ],
        options: {
          promptKey: 'default',
          model_id: 'scripted-test-model',
          project_metadata: { id: projectId, name: 'Batch feedback' },
        },
      },
      event => {
        live.push(event);
      }
    );

    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 200 })).events;
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(count * 2);
    expect(outputs.map(event => [event.tool_call_id, event.status])).toEqual([
      ...writes.map(tool => [tool.id, 'success']),
      ...edits.map((tool, index) => [tool.id, index < count - 2 ? 'success' : 'error']),
    ]);
    expect(
      outputs.filter(event => event.status === 'error').map(event => event.error_code)
    ).toEqual(['OLD_STRING_NOT_FOUND', 'OLD_STRING_NOT_FOUND']);
    const expectedResults = outputs.map(event => ({
      tool_call_id: event.tool_call_id,
      status: event.status,
      observation: event.observation,
      error_code: event.error_code,
    }));
    expect(
      live
        .filter(event => event.type === 'tool_output')
        .map(event => ({
          tool_call_id: event.tool_call_id,
          status: event.status,
          observation: event.observation,
          error_code: event.error_code,
        }))
    ).toEqual(expectedResults);
    const reloaded = readTail(fixture.db, conversationId, 100);
    if (reloaded.status !== 'ready') throw new Error('Expected durable UI window');
    expect(
      reloaded.messages
        .filter(message => message.message_type === 'tool_calls')
        .map(message => ({
          tool_call_id: message.payload.tool_call_id,
          status: message.payload.status,
          observation: message.content,
          error_code: message.payload.error_code,
        }))
    ).toEqual(expectedResults);

    fixture.ai.assertAllTurnsConsumed();
    const requests = fixture.ai.getCalls();
    expect(requests).toHaveLength(3);
    for (const [batchIndex, batch] of [writes, edits].entries()) {
      const ids = new Set(batch.map(tool => tool.id));
      const request = requests[batchIndex + 1];
      if (!request) throw new Error('Missing next model request');
      const delivered = request.messages.filter(
        message => message.role === 'tool' && ids.has(message.tool_call_id)
      );
      // EventStore 有结果不等于模型看到结果：逐条核对真正送入 LlmCaller 的 ID、顺序和正文。
      expect(delivered).toEqual(
        outputs
          .filter(event => ids.has(event.tool_call_id))
          .map(event =>
            expect.objectContaining({
              role: 'tool',
              tool_call_id: event.tool_call_id,
              content: [{ type: 'text', text: event.observation }],
            })
          )
      );
      const declared = request.messages.flatMap(message =>
        message.role === 'assistant'
          ? message.parts.flatMap(part =>
              part.type === 'tool_call' && ids.has(part.call.id) ? [part.call.id] : []
            )
          : []
      );
      expect(declared).toEqual(batch.map(tool => tool.id));
    }
    expect((await fixture.runtime.supervisor.findByConversation(conversationId))[0]?.status).toBe(
      'completed'
    );
  });

  it('成功差异、失效错误与回读进入下一轮；恢复内容后相同编辑仍真实执行', async () => {
    const replacement = { old_string: '计算值是10。', new_string: '计算值是12。' };
    const calls = [
      call('create', 'write_file', { content: '# 报告\n\n计算值是10。\n' }),
      call('first-edit', 'edit_file', replacement),
      call('stale-edit', 'edit_file', replacement),
      call('reload', 'read_file', {}),
      call('restore', 'edit_file', {
        old_string: replacement.new_string,
        new_string: replacement.old_string,
      }),
      call('valid-again', 'edit_file', replacement),
      call('verify', 'read_file', {}),
    ];
    // 不替换工具：空自定义列表使用正式 Registry、VFS、Markdown 和失败投影。
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      ...calls.map(tool => ({ toolCalls: [tool] })),
      { contentChunks: ['已完成并回读。'] },
    ]);
    const conversationId = 'file-edit-feedback';
    const projectId = new WorkspaceService(fixture.db).createProject('Edit feedback');
    await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    await fixture.flow.next(
      {
        conversation_id: conversationId,
        project_id: projectId,
        new_events: [
          { type: 'user_input', content: '修改报告并核对结果。', source: 'user', timestamp: 1 },
        ],
        options: {
          promptKey: 'default',
          model_id: 'scripted-test-model',
          project_metadata: { id: projectId, name: 'Edit feedback' },
        },
      },
      () => {}
    );

    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs.map(event => [event.tool_call_id, event.status])).toEqual([
      ['create', 'success'],
      ['first-edit', 'success'],
      ['stale-edit', 'error'],
      ['reload', 'success'],
      ['restore', 'success'],
      ['valid-again', 'success'],
      ['verify', 'success'],
    ]);
    const succeeded = outputs.find(event => event.tool_call_id === 'first-edit');
    if (!succeeded || succeeded.status !== 'success') throw new Error('Expected committed edit');
    const result = WorkspaceEditFileResultSchema.parse({
      data: succeeded.data,
      observation: succeeded.observation,
    });
    expect(result.observation).toContain(result.data.diff);
    expect(result.data.diff).toContain('-计算值是10。\n+计算值是12。');
    const failed = outputs.find(event => event.tool_call_id === 'stale-edit');
    expect(failed).toMatchObject({ status: 'error', error_code: 'OLD_STRING_NOT_FOUND' });
    expect(failed?.observation).toContain('Use read_file');

    const requests = fixture.ai.getCalls();
    fixture.ai.assertAllTurnsConsumed();
    const toolMessage = (index: number, id: string) =>
      requests[index]?.messages.find(
        message => message.role === 'tool' && message.tool_call_id === id
      );
    // 只检查实际 canonical model input，不能用持久化 data 假装模型已看到差异。
    expect(toolMessage(2, 'first-edit')).toMatchObject({
      content: [{ type: 'text', text: result.observation }],
    });
    expect(toolMessage(3, 'stale-edit')).toMatchObject({
      content: [{ type: 'text', text: failed?.observation }],
    });
    expect(JSON.stringify(toolMessage(4, 'reload'))).toContain('计算值是12。');
    expect(JSON.stringify(toolMessage(7, 'verify'))).toContain('计算值是12。');
    expect((await fixture.runtime.supervisor.findByConversation(conversationId))[0]?.status).toBe(
      'completed'
    );
  });
});
