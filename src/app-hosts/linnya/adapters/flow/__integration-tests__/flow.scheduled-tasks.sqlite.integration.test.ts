import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import { createProjectLifecycle } from 'src/domains/projects';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { DEFAULT_COMMAND_PERMISSION_SETTINGS, serializeCommandPermissionSettings } from 'src/domains/commands/features/permission-settings';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { clearPluginRuntimeStateForTests, setPluginRuntimeStateForTests } from '../../../plugin-registry/pluginRuntimeState';
import { createConversationCommandPermissions, type ConversationCommandPermissions } from '../../../application/conversation-command-permissions';
import { createScheduledTasks } from '../../../application/scheduled-tasks';
import { prepareSchedulesCli } from '../../../application/core-cli/orchestration/prepareSchedulesCli';
import { SqliteConversationCommandPermissions } from '../../persistence/conversation-command-permissions/sqliteConversationCommandPermissions';
import { SqliteUiProjectionApplier } from '../../persistence/event-store/ui-projection/sqliteApplier';
import { createConversationActivityPorts } from '../../persistence/run-registry';
import { createSqliteScheduledTasks } from '../../persistence/scheduled-tasks/sqliteScheduledTasks';
import { createScheduledTaskExecution } from '../../scheduled-tasks/createScheduledTaskExecution';
import { createDurableFlowHarness, installRecoveryModelFixture } from '../__test-helpers__/createDurableFlowHarness';

it('uses real Flow admission to freeze the scheduled identity, model and permission in SQLite and rejects recursive CLI writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'linnya-scheduled-flow-'));
  const modelId = 'scripted-test-model';
  const restore = installRecoveryModelFixture();
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  const releaseModel = Promise.withResolvers<void>();
  let permissions: ConversationCommandPermissions | undefined;
  const globalSettings: CommandPermissionSettingsPort = {
    read: () => ({ status: 'found', serialized: serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS) }),
    write: () => { throw new Error('Scheduled admission must not change global settings'); },
  };
  let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
  let tasks: ReturnType<typeof createScheduledTasks> | undefined;
  const failures: unknown[] = [];
  try {
    const f = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [{
      assertCall: () => releaseModel.promise, contentChunks: ['Scheduled answer'], finishReason: 'stop',
    }], [], true, {
      commandPermissionSettings: globalSettings,
      readConversationCommandPermission(id) {
        if (!permissions) throw new Error('Schedule permission port was not installed');
        return permissions.readSelection(id);
      },
    });
    fixture = f;
    permissions = createConversationCommandPermissions({
      store: new SqliteConversationCommandPermissions(f.db, fact => new SqliteUiProjectionApplier(f.db).projectCommandPermissionChange(fact)),
      globalSettings,
      admission: { async withAdmission(request, admitted) {
        return admitted({ identity: deriveConversationWorkDirectoryIdentity(request.conversationId), status: 'existing', absolutePath: directory });
      } },
      onFailure: error => failures.push(error),
    });
    const projectId = createProjectLifecycle(f.db).create({ name: 'Scheduled work' });
    let now = Date.parse('2026-11-23T11:59:00Z');
    const store = createSqliteScheduledTasks(f.db);
    const schedules = createScheduledTasks({ store, schedulerEnabled: true, now: () => now, timezone: () => 'UTC',
      projectExists: id => id === projectId, defaultModel: () => modelId, modelAvailable: id => id === modelId,
      execution: createScheduledTaskExecution({
        flow: { start: request => f.flow.nextDetached(request), stop: (runId, conversationId, reason) => f.flow.cancelRun(runId, conversationId, reason) },
        history: { updateConversationSelectedAgent: (id, agent, project) => f.eventStore.updateSelectedAgent(id, agent, project) },
        permissions, activity: createConversationActivityPorts(f.db, { readControlPending: () => [] }),
      }),
      settings: { read: () => ({ max_concurrent_runs: 1 }), write() {} },
      usage: () => null, storage: () => null, publish() {}, notify: async () => {}, logError: (_message, error) => failures.push(error),
    });
    tasks = schedules;
    const created = await schedules.create({ project_id: projectId, name: 'Research brief', prompt: 'Summarize the project notes.',
      agent: 'research', model_config_id: null, schedule: { kind: 'daily', time: '12:00' },
      missed_policy: 'run_latest', permission_level: 'read_only' });
    if (!created.ok) throw new Error(created.message);
    schedules.lifecycle.start();
    await schedules.tick();
    now += 60_000;
    await schedules.tick();
    const run = store.pendingRuns()[0];
    if (!run?.run_id || !run.conversation_id) throw new Error(`Flow did not admit the run: ${String(failures[0])}`);
    const descriptor = await f.runtime.runDescriptors?.load(run.run_id);
    expect(descriptor).toMatchObject({
      agentSpec: { id: 'scheduled_research' },
      options: { scheduled_run: { task_id: created.task.id, task_run_id: run.id, planned_at: now } },
      request: { model_id: modelId, researchScope: { task_type: 'open' }, frozenSystemPrompt: expect.stringContaining('Actual start: 2026-11-23T12:00:00.000Z') },
      executorLocal: { lockRequestedModelId: true },
      commandPermission: { status: 'available', snapshot: { permission_level: 'read_only', source: 'conversation_setting' } },
    });
    expect(descriptor?.request.availableTools).not.toContain('ask');
    expect(descriptor?.request.availableTools).not.toContain('skill_manage');
    expect((await f.eventStore.getConversationMetadata(run.conversation_id))?.selected_agent_id)
      .toBe(ConversationSelectedAgentIdSchema.parse('research_v1'));

    f.db.prepare("INSERT INTO runs (id, conversation_id, kind, status, parent_run_id, start_ts) VALUES (?, ?, 'agent', 'completed', ?, ?)")
      .run('child-scheduled-test', run.conversation_id, run.run_id, now);
    const cli = prepareSchedulesCli(f.db, ['create', '--name', 'Self-replicating task', '--prompt', 'Example', '--cron', '0 * * * *'], () => schedules);
    if (cli.status !== 'ready') throw new Error('Expected a write plan');
    expect(cli.plan.access.internalDataAccess).toBe('write');
    for (const agentRunId of [run.run_id, 'child-scheduled-test']) {
      const result = await cli.plan.execute({ projectId, conversationId: run.conversation_id, agentRunId,
        hostContext: {}, signal: new AbortController().signal });
      expect(result).toMatchObject({ exitCode: 77, stderr: expect.stringContaining('scheduled_run_write_forbidden') });
    }
    releaseModel.resolve();
    await vi.waitFor(async () => {
      await schedules.tick();
      expect(store.readRunAt(created.task.id, now)).toMatchObject({ status: 'completed', conversation_id: run.conversation_id });
    });
    expect(failures).toEqual([]);
  } finally {
    releaseModel.resolve();
    await tasks?.lifecycle.stop();
    fixture?.close();
    resetAgentRuntimeSingletonsForTest();
    clearPluginRuntimeStateForTests();
    restore();
    rmSync(directory, { recursive: true, force: true });
  }
});
