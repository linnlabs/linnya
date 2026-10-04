import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceEditFileResultSchema } from '@app/schemas';
import type { ScriptedToolCall } from '@linnlabs/linnkit/testkit';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
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
