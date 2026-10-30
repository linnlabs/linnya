import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { ToolContext } from 'src/tools/types';
import { createDurableFlowHarness, installRecoveryModelFixture } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDurableFlowHarness';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { setPluginRuntimeStateForTests, clearPluginRuntimeStateForTests } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { replacePluginSkillSourceRoots } from 'src/features/skills/pluginSkillSources';
import { invalidateSkillCache } from 'src/features/skills/discovery';
import { createProjectLifecycle } from 'src/domains/projects';
import { backendPlugin } from '../decision/src/backend';
import { decisionToolManifest } from '../decision/src/backend/toolManifest';
import { rendererPlugin } from '../decision/src/renderer';
import { DecisionFinishTool } from '../decision/src/backend/features/decision-delivery/DecisionFinishTool';
import { decisionMigrations } from '../decision/src/backend/features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../decision/src/backend/features/decision-cli/orchestration/executeDecisionCommand';
import { createDecisionRecordRepository, renderDecisionDelivery } from '../decision/src/backend/features/decision-record';
import { deliveryPurchaseModel, deliveryPurchaseAdvice } from '../decision/src/backend/__tests__/fixtures/deliveryPurchase';

// 只替换文件 capability 的路径 transport；SQLite、领域用例、工具、Graph、Flow 和历史均是真实实现。
const filePort = vi.hoisted(() => ({ root: '', available: true }));
vi.mock('@plugin/backend/workspaceRuntime', async importOriginal => ({
  ...await importOriginal<typeof import('@plugin/backend/workspaceRuntime')>(),
  createConversationFilePathResolver: () => filePort.available ? { resolveRelativePath: async ({ relativePath }: { relativePath: string }) => join(filePort.root, relativePath) } : undefined,
}));
let dir: string; let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>>; let project: string; let id: string;
const conversation = 'decision-delivery-test';
let toolResult = ''; 
const permission = { status: 'available', snapshot: { protocol_version: 1, kind: 'command_run_permission_snapshot', root_agent_run_id: 'delivery-test', settings_revision: 0, captured_at_ms: 1, permission_level: 'full_access', internal_data_access: 'allowed', gui_control: 'denied', local_ipc_control: 'denied', process_lifecycle: 'terminate_with_run' } };
class FixtureFinish extends DecisionFinishTool {
  override async run(args: Record<string, unknown>, context: ToolContext) {
    // 该 Flow fixture 无 Commands runtime；只注入等同生产 admission 的冻结权限。
    toolResult = await super.run(args, Object.assign({}, context, { commandRunPermission: permission }));
    return toolResult;
  }
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'decision-finish-flow-')); filePort.root = dir; filePort.available = true;
  ensureBuiltinBackendPluginsRegistered();
  if (!backendPluginRegistry.has('decision')) backendPluginRegistry.register(backendPlugin, { allowPluginCli: true });
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', 'decision'], installedPluginIds: ['platform', 'decision'] });
  installRecoveryModelFixture();
  fixture = await createDurableFlowHarness(join(dir, 'state.sqlite'), [{ toolCalls: [{ id: 'finish', name: 'decision_finish', get argumentsJson() { return JSON.stringify({ decisionId: id, expectedRevision: 2 }); } }] }], [new FixtureFinish()]);
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', 'decision'], installedPluginIds: ['platform', 'decision'] });
  replacePluginSkillSourceRoots([{ pluginId: 'decision', root: join(import.meta.dirname, '../decision/resources/skills') }]); invalidateSkillCache();
  project = createProjectLifecycle(fixture.db).create({ name: 'Delivery fixture' });
  await fixture.eventStore.ensureConversation(conversation, [], project, 'agent');
  for (const migration of decisionMigrations) migration.up(fixture.db);
  const created = executeDecisionCommand({ kind: 'create', model: deliveryPurchaseModel() }, fixture.db, project);
  if (!created || typeof created !== 'object' || !('record' in created)) throw new Error('fixture'); id = created.record.id;
  executeDecisionCommand({ kind: 'recommend', id, expectedRevision: 1, recommendation: deliveryPurchaseAdvice() }, fixture.db, project);
});
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 0)); fixture?.close(); resetAgentRuntimeSingletonsForTest(); clearPluginRuntimeStateForTests(); vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
it('persists the exact program final answer once and completes without another LLM turn; history and tool card keep the same identity', async () => {
  await fixture.flow.next({ conversation_id: conversation, project_id: project,
    new_events: [{ type: 'user_input', content: '交付当前建议', source: 'user', timestamp: 1 }], selected_agent_id: 'decision_agent',
    options: { promptKey: 'decision_agent', model_id: 'scripted-test-model', project_metadata: { id: project } },
  }, () => {});
  fixture.ai.assertAllTurnsConsumed(); expect(fixture.ai.getCalls()).toHaveLength(1);
  const events = (await fixture.eventStore.readEvents(conversation, { limit: 100 })).events;
  const output = events.find(e => e.type === 'tool_output'); const finals = events.filter(e => e.type === 'final_answer');
  expect(output?.type).toBe('tool_output'); expect(finals).toHaveLength(1);
  if (!output || output.type !== 'tool_output') throw new Error('output');
  const parsed: unknown = JSON.parse(toolResult);
  const receipt = z.object({ data: z.object({ decisionId: z.string(), revision: z.number(), artifact: z.object({ locator: z.string() }), originalArtifact: z.object({ locator: z.string() }) }), control: z.object({ finalAnswer: z.string(), terminateRun: z.literal(true) }) }).parse(parsed);
  expect(output.data).toMatchObject(receipt.data);
  expect(finals[0].content).toBe(receipt.control.finalAnswer);
  const file = readFileSync(join(dir, receipt.data.artifact.locator.slice('conversation:/'.length)), 'utf8');
  expect(file).toBe(receipt.control.finalAnswer);
  const original = readFileSync(join(dir, receipt.data.originalArtifact.locator.slice('conversation:/'.length)), 'utf8');
  expect(original).toBe(renderDecisionDelivery(createDecisionRecordRepository(fixture.db, project).read(id), 2).originalMarkdown);
  expect(file).toContain(receipt.data.originalArtifact.locator); expect(file).not.toContain('## 输入身份与未知');
  expect(finals[0].content).toBe(file);
  expect(original).toContain('只有书面承诺不改变现金');
  expect(finals[0].content).not.toContain('只有书面承诺不改变现金');
  expect((await fixture.flow.getActiveForegroundRun(conversation)).run).toBeNull();
  const card = rendererPlugin.toolCards?.[new DecisionFinishTool().name];
  if (!card || !('presentation' in card) || !card.presentation || !card.compactStep) throw new Error('Missing card');
  const input = { sourceToolName: 'decision_finish', uiKey: 'decision_finish', toolCallId: 'finish', args: {}, result: parsed, status: 'success' as const, phase: 'complete' as const };
  expect(card.presentation(input).title?.text.params).toEqual({ revision: '2' });
  expect(card.compactStep(input).title.params).toEqual({ revision: '2' });
  expect(decisionToolManifest.allNames).toEqual(backendPlugin.toolClasses?.map(Tool => new Tool().name));
  expect(backendPlugin.agentDefinitions?.[0].config.availableTools).toContain('decision_finish');
  const history = (await fixture.eventStore.readEvents(conversation, { limit: 100 })).events;
  expect(history.filter(e => e.type === 'final_answer').map(e => e.content)).toEqual([receipt.control.finalAnswer]);
});
it('rejects disabled, denied, read-only, stale, cross-project and cancelled delivery without final-control output', async () => {
  const tool = new DecisionFinishTool();
  const context = { databaseService: fixture.database, workspaceProjectId: project, conversationId: conversation, abortSignal: new AbortController().signal, commandRunPermission: permission };
  const args = { decisionId: id, expectedRevision: 2 };
  await expect(tool.run({ ...args, answer: 'override' }, context)).rejects.toThrow();
  await expect(tool.run({ ...args, expectedRevision: 1 }, context)).rejects.toThrow('Revision conflict');
  await expect(tool.run(args, { ...context, workspaceProjectId: 'other' })).rejects.toThrow('not found');
  for (const snapshot of [{ ...permission.snapshot, internal_data_access: 'denied' }, { ...permission.snapshot, permission_level: 'read_only' }]) {
    await expect(tool.run(args, { ...context, commandRunPermission: { status: 'available', snapshot } })).rejects.toThrow('permission');
  }
  const stop = new AbortController(); stop.abort(new Error('stop')); await expect(tool.run(args, { ...context, abortSignal: stop.signal })).rejects.toThrow('stop');
  filePort.available = false; await expect(tool.run(args, context)).rejects.toThrow('file capability'); filePort.available = true;
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'], installedPluginIds: ['platform', 'decision'] });
  await expect(tool.run(args, context)).rejects.toThrow('disabled');
  expect(createDecisionRecordRepository(fixture.db, project).read(id).revision).toBe(2);
});
