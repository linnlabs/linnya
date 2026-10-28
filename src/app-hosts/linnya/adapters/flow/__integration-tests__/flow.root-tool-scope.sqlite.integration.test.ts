import { createProjectLifecycle } from 'src/domains/projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';
import { clearRegisteredAgentTaskCache } from '../../../agent-registry/agentTaskResolver';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { toolRegistry } from '../../tools/toolRegistry';

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-root-tool-scope-'));
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  installRecoveryModelFixture();
  clearRegisteredAgentTaskCache();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture?.close();
  fixture = undefined;
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  clearRegisteredAgentTaskCache();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function restrictRoot(availableTools: readonly string[]) {
  const originalLookup = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
  vi.spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey').mockImplementation(key => {
    const definition = originalLookup(key);
    return definition?.promptKey === 'default'
      ? { ...definition, config: { ...definition.config, availableTools } }
      : definition;
  });
}

describe('root run tool execution scope', () => {
  it.each([['read_file'], []])(
    '模型伪造目录外的正式 Workspace 写入时，真实 Flow 在 owner 前拒绝：%j',
    async (...allowedTools) => {
      restrictRoot(allowedTools);
      fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
        {
          assertCall(call) {
            expect(call.options.tools?.some(tool => tool.name === 'write_file')).toBe(false);
          },
          toolCalls: [
            {
              id: 'forged-root-write',
              name: 'write_file',
              argumentsJson: JSON.stringify({
                locator: 'workspace:/forbidden.md',
                content: '# Forbidden',
              }),
            },
          ],
        },
        { contentChunks: ['The write was not authorized.'] },
      ]);
      const projectId = createProjectLifecycle(fixture.db).create({ name: 'Synthetic read-only root' });
      const conversationId = 'root-tool-scope';
      await fixture.flow.next(
        {
          conversation_id: conversationId,
          project_id: projectId,
          new_events: [{ type: 'user_input', source: 'user', content: 'Read only.', timestamp: 1 }],
          options: {
            promptKey: 'default',
            model_id: 'scripted-test-model',
            project_metadata: { id: projectId },
          },
        },
        () => {}
      );
      const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
      expect(
        events.find(
          event => event.type === 'tool_output' && event.tool_call_id === 'forged-root-write'
        )
      ).toMatchObject({ status: 'error', error: expect.stringContaining('未获准') });
      expect(
        fixture.db.prepare("SELECT id FROM workspace_nodes WHERE name = 'forbidden.md'").all()
      ).toHaveLength(0);
      fixture.ai.assertAllTurnsConsumed();
    }
  );

  it('明确 Host 入口仅授权原始 call，后继模型同名写入不能借用权限', async () => {
    restrictRoot([]);
    const forgedCall = {
      id: 'forged-second-write',
      name: 'write_file',
      argumentsJson: JSON.stringify({
        locator: 'workspace:/second.md',
        content: '# Unauthorized second write',
      }),
    };
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      {
        assertCall(call) {
          expect(call.options.tools ?? []).toHaveLength(0);
        },
        toolCalls: [forgedCall],
      },
      { contentChunks: ['Only the Host write was authorized.'] },
    ]);
    const projectId = createProjectLifecycle(fixture.db).create({ name: 'Host single-call scope' });
    const conversationId = 'root-host-tool-scope';
    await fixture.flow.next(
      {
        conversation_id: conversationId,
        project_id: projectId,
        new_events: [
          {
            type: 'user_input',
            source: 'system',
            content: 'Perform the single Host write.',
            timestamp: 1,
          },
        ],
        options: {
          promptKey: 'default',
          model_id: 'scripted-test-model',
          project_metadata: { id: projectId },
          host_tool_call: {
            tool_name: 'write_file',
            args: { locator: 'workspace:/authorized.md', content: '# Authorized' },
          },
        },
      },
      () => {}
    );
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ tool_name: 'write_file', status: 'success' });
    expect(outputs[1]).toMatchObject({
      tool_call_id: forgedCall.id,
      status: 'error',
      error: expect.stringContaining('未获准'),
    });
    expect(
      fixture.db
        .prepare("SELECT name FROM workspace_nodes WHERE name IN ('authorized.md', 'second.md')")
        .all()
    ).toEqual([{ name: 'authorized.md' }]);
    fixture.ai.assertAllTurnsConsumed();
  });

  it('Host 只读入口中断后恢复原 call，空模型名单不阻断明确接纳的执行', async () => {
    restrictRoot([]);
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), []);
    const projectId = createProjectLifecycle(fixture.db).create({ name: 'Host recovery scope' });
    const conversationId = 'root-host-tool-resume';
    const tool = toolRegistry.getTool('list_files');
    if (!tool) throw new Error('Workspace list tool is unavailable');
    const run = vi
      .spyOn(tool, 'run')
      .mockRejectedValueOnce(new graph.RunRecoveryBlockedError('Synthetic read interruption'));
    await fixture.flow.next(
      {
        conversation_id: conversationId,
        project_id: projectId,
        new_events: [
          { type: 'user_input', source: 'system', content: 'List the project.', timestamp: 1 },
        ],
        options: {
          promptKey: 'default',
          model_id: 'scripted-test-model',
          project_metadata: { id: projectId },
          host_tool_call: {
            tool_name: 'list_files',
            args: { locator: 'workspace:/' },
            completion_mode: 'yield_after_batch',
          },
        },
      },
      () => {}
    );
    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!active || active.status !== 'paused' || !active.pause?.settled || !active.execution_id)
      throw new Error('Expected settled pause');
    await fixture.flow.continueRun(
      active.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: active.execution_id,
        expected_updated_at: active.pause.updated_at,
      },
      () => {}
    );
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(events.filter(event => event.type === 'tool_call_decision')).toHaveLength(1);
    expect(events.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({ tool_name: 'list_files', status: 'success' }),
    ]);
    expect(run).toHaveBeenCalledTimes(2);
    expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    fixture.ai.assertAllTurnsConsumed();
  });
});
