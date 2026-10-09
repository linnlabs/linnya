import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceEditFileResultSchema } from '@app/schemas';
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
