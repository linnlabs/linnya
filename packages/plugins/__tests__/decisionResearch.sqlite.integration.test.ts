import { toolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import { replacePluginSkillSourceRoots } from 'src/features/skills/pluginSkillSources';
import { invalidateSkillCache } from 'src/features/skills/discovery';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { backendPlugin } from '../decision/src/backend';
import { decisionMigrations } from '../decision/src/backend/features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../decision/src/backend/features/decision-cli/orchestration/executeDecisionCommand';
import { decisionPluginCli } from '../decision/src/backend/features/decision-cli/orchestration/prepareDecisionCli';
import { createResearchJobRepository } from '../decision/src/backend/features/decision-research/persistence/researchJobRepository';
import { executeResearchCommand } from '../decision/src/backend/features/decision-research/orchestration/executeResearchCommand';
import { DecisionRecordSchema } from '../decision/src/shared';
import { createChildRunDeliveryReader } from 'src/plugin-sdk/backend/childRunDelivery';
import { BaseTool, type ToolContext } from 'src/tools/types';
import { SubagentTool } from 'src/tools/agent_control/subrun/subagent/subagentTool';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import { TaskWriteTool } from 'src/tools/agent_control/task/taskWriteTool';
import { TaskReadTool } from 'src/tools/agent_control/task/taskReadTool';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { setPluginRuntimeStateForTests, clearPluginRuntimeStateForTests } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { createDurableFlowHarness, installRecoveryModelFixture } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDurableFlowHarness';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>>;
let projectId: string;
let decisionId: string;
let preparedPrompt = '';
let requestId = '';
let admittedResearch: AgentInvokeRequest | undefined;
let beforeRead: ((context: ToolContext) => Promise<void>) | undefined;
class BoundaryRead extends ReadFileTool {
  override async run(args: Record<string, unknown>, context: ToolContext) {
    await beforeRead?.(context);
    return super.run(args, context);
  }
}
const conversationId = 'decision-research-composition';
const scope = { question: '核对两个合成课程的到达时间、费用和可行条件，形成短研究。', reader: '决策者', task_type: 'fixed', materials: ['workspace:/source.md'] };

/** 只替换 Shell 进程/CLI transport；CLI 接纳、数据库、Graph、文件工具和 child 都使用生产实现。 */
class CliBridgeFixture extends BaseTool {
  readonly name = 'shell';
  readonly description = 'CLI transport fixture';
  readonly parameters = { type: 'object' as const, properties: { operation: { type: 'string' as const } }, required: ['operation'] };
  async run(args: Record<string, unknown>, context: ToolContext) {
    const argv = args.operation === 'prepare'
      ? ['research', 'prepare', decisionId, '--expected-revision', '1', '--input', 'scope.json']
      : ['research', 'receive', requestId];
    const prepared = decisionPluginCli.prepare({ argv, conversationRoot: directory, invocationId: 'test-cli-invocation' });
    if (prepared.status !== 'ready') throw new Error('CLI prepare failed');
    const result = await prepared.plan.execute({ hostContext: context, conversationId, projectId, agentRunId: context.runId, signal: context.abortSignal ?? new AbortController().signal });
    if (result.exitCode !== 0) throw new Error(result.stderr);
    if (args.operation === 'prepare') {
      const jobs = createResearchJobRepository(fixture.db, projectId).list(decisionId);
      const job = jobs[0];
      if (!job) throw new Error('Missing prepared job');
      preparedPrompt = job.prompt; requestId = job.id;
    }
    return JSON.stringify({ data: result, observation: result.stdout });
  }
}
function tool(id: string, name: string, args: Record<string, unknown>): ScriptedLlmTurn {
  return { toolCalls: [{ id, name, argumentsJson: JSON.stringify(args) }] };
}
function write(id: string, path: string, content: string) { return tool(id, 'write_file', { locator: `workspace:/${path}.md`, content }); }
const read = (id: string, path: string) => tool(id, 'read_file', { locator: `workspace:/${path}.md` });
const review = (id: string, type: string) => tool(id, 'subagent', { description: id, subagent_type: type,
  prompt: `仅核对 workspace:/draft.md 和 workspace:/source.md；保存 workspace:/${id}.md，不读取同伴。` });
function prefix(): ScriptedLlmTurn[] {
  return [
    tool('prepare', 'shell', { operation: 'prepare' }),
    { toolCalls: [{ id: 'research', name: 'subagent', get argumentsJson() { return JSON.stringify({ description: '核对课程', subagent_type: 'decision_research', prompt: preparedPrompt }); } }] },
    tool('plan', 'task_write', { goal: '独立核对课程', current_phase: 'execute', current_plan: ['调查', '初稿', '双评审', '修订'], progress: '开始核查', next_steps: ['读取材料'], references: ['workspace:/source.md'] }),
    read('source-read', 'source'),
    write('research-record', 'research', '# 调查\n\n课程 A 最早 18:40 到达，B 最早 18:10 到达。'),
    write('draft-write', 'draft', '# 课程比较\n\nA 需 40 分钟，B 需 10 分钟；18:30 开课时 A 不可行。'),
    review('argument', 'research_argument_review'),
    read('argument-read', 'draft'),
    write('argument-write', 'argument', '# 论证评审\n\n须对照开课时间，不把未知等待当作零。'),
    { contentChunks: ['论证意见已保存 workspace:/argument.md。'] },
    review('sources', 'research_source_review'),
  ];
}
function suffix(): ScriptedLlmTurn[] {
  return [
    read('source-review-read', 'source'),
    write('sources-write', 'sources', '# 来源评审\n\n合成来源给出单程通勤；没有往返加倍的依据。'),
    { contentChunks: ['来源意见已保存 workspace:/sources.md。'] },
    read('review-read-argument', 'argument'), read('review-read-sources', 'sources'),
    write('final-write', 'final', '# 课程选择\n\n若 18:30 开课且 18:00 下班，B 可在 18:10 到达；A 最早 18:40 到达。费用仍待确认，不能用打平成本冒充个人偏好。'),
    read('final-read', 'final'),
    { contentChunks: ['研究稿 workspace:/final.md；原始意见 workspace:/argument.md 与 workspace:/sources.md。'] },
    tool('receive', 'shell', { operation: 'receive' }),
    { contentChunks: ['依据研究比较课程，费用未知，先询价。不把完成等同于正确。'] },
  ];
}
async function open(turns: ScriptedLlmTurn[]) {
  fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns,
    [new CliBridgeFixture(), new SubagentTool(), new WriteFileTool(), new BoundaryRead(), new TaskWriteTool(), new TaskReadTool()]);
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', 'decision'], installedPluginIds: ['platform', 'decision'] });
  replacePluginSkillSourceRoots([{ pluginId: 'decision', root: join(import.meta.dirname, '../decision/resources/skills') }]);
  invalidateSkillCache();
  const admission = fixture.runtime.runAdmissionCommit;
  if (!admission) throw new Error('Missing admission owner');
  const start = admission.start.bind(admission);
  vi.spyOn(admission, 'start').mockImplementation(async input => {
    if (input.descriptor.request.promptKey === 'research_v1') admittedResearch = input.descriptor.request;
    await start(input);
  });
  return fixture;
}
async function seed() {
  writeFileSync(join(directory, 'scope.json'), JSON.stringify(scope));
  const workspace = new WorkspaceService(fixture.db);
  projectId = workspace.createProject('Managed decision research');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  for (const migration of decisionMigrations) migration.up(fixture.db);
  const record = executeDecisionCommand({ kind: 'create', model: {
    title: '课程选择', question: '选一门可赶到的课',
    inputs: [{ id: 'end', label: '下班时间', kind: 'fact', value: '18:00', origin: '用户', status: 'available' }],
    options: [{ id: 'A', label: '课程A', description: '40分钟' }, { id: 'B', label: '课程B', description: '10分钟' }], calculations: [], checks: [],
  } }, fixture.db, projectId);
  if (typeof record !== 'object' || record === null || !('record' in record)) throw new Error('Missing decision');
  decisionId = DecisionRecordSchema.parse(record.record).id;
  await new WriteFileTool().run({ locator: 'workspace:/source.md', content: '# 合成课程\n\n18:00 下班。A 单程40分钟，B 单程10分钟，均18:30开课。费用未知。' },
    { ...context() });
}
async function start() {
  await fixture.flow.next({ conversation_id: conversationId, project_id: projectId,
    new_events: [{ type: 'user_input', content: '核对课程后再给建议', source: 'user', timestamp: 1 }],
    selected_agent_id: 'decision_agent',
    options: { promptKey: 'decision_agent', model_id: 'scripted-test-model', reasoning_effort: 'low', project_metadata: { id: projectId } },
  }, () => {});
}
function context() { return { databaseService: fixture.database, workspaceProjectId: projectId, conversationId, workspaceService: new WorkspaceService(fixture.db) }; }
async function view() {
  const job = createResearchJobRepository(fixture.db, projectId).read(requestId);
  return executeResearchCommand({ kind: 'research_read', id: requestId }, { db: fixture.db, projectId, conversationId, runId: job.runId,
    reader: await createChildRunDeliveryReader({ hostContext: context(), conversationId, projectId, signal: new AbortController().signal }), signal: new AbortController().signal });
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-decision-research-'));
  preparedPrompt = ''; requestId = ''; admittedResearch = undefined; beforeRead = undefined;
  ensureBuiltinBackendPluginsRegistered();
  void toolRegistry;
  if (!backendPluginRegistry.has(backendPlugin.meta.id)) backendPluginRegistry.register(backendPlugin, { allowPluginCli: true });
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', 'decision'], installedPluginIds: ['platform', 'decision'] });
  installRecoveryModelFixture({ supported_efforts: ['low', 'high'], default_effort: 'high' });
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture?.close(); resetAgentRuntimeSingletonsForTest(); clearPluginRuntimeStateForTests(); vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
describe('decision -> full research -> leaf reviews -> version-bound delivery', () => {
  it('真实三层树与 TaskState，接回正式文件版本；重复接回无模型调用，后续编辑标记失效', async () => {
    await open([...prefix(), ...suffix()]); await seed(); await start();
    fixture.ai.assertAllTurnsConsumed();
    expect(await view()).toMatchObject({ status: 'received', reviewsComplete: true, changedInputs: false });
    const job = createResearchJobRepository(fixture.db, projectId).read(requestId);
    const children = (await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(job.runId) })).runs;
    expect(children).toHaveLength(1);
    const coordinator = children[0]; if (!coordinator) throw new Error('Missing coordinator');
    expect((await fixture.runtime.supervisor.list({ parentRunId: coordinator.runId })).runs).toHaveLength(2);
    expect(admittedResearch?.researchScope?.task_type).toBe('fixed');
    expect(admittedResearch?.delegation?.prompt).toBe(preparedPrompt);
    expect(admittedResearch?.allowedSubagentTypes).toEqual(backendPlugin.subagentTypes?.[0]?.allowedSubagentTypes);
    expect(fixture.ai.getCalls().every(call => call.options.reasoning_effort === 'low')).toBe(true);
    const before = fixture.ai.getCalls().length;
    const received = await executeResearchCommand({ kind: 'research_receive', id: requestId }, { db: fixture.db, projectId, conversationId, runId: job.runId,
      reader: await createChildRunDeliveryReader({ hostContext: context(), conversationId, projectId, signal: new AbortController().signal }), signal: new AbortController().signal });
    expect(received).toMatchObject({ status: 'received' }); expect(fixture.ai.getCalls()).toHaveLength(before);
    expect(job.delivery?.documents).toHaveLength(5);
    await new WriteFileTool().run({ locator: 'workspace:/argument.md', content: '# 评审已改动\n\n这不是原评审。' }, context());
    expect(await view()).toMatchObject({ status: 'needs_review', changedDocuments: expect.arrayContaining([expect.stringMatching(/^workspace:/)]) });
    await new WriteFileTool().run({ locator: 'workspace:/final.md', content: '# 已改动\n\n这不是原交付。' }, context());
    expect(await view()).toMatchObject({ status: 'needs_review', changedDocuments: expect.arrayContaining([expect.stringMatching(/^workspace:/)]) });
  });
  it('研究期间条件撤回，旧产物保留原 inputRevision，不能变成最新建议', async () => {
    const tail = suffix();
    const checkpoint = tail[0]; if (!checkpoint) throw new Error('Missing review turn');
    checkpoint.assertCall = () => { executeDecisionCommand({ kind: 'update', id: decisionId, expectedRevision: 1,
      update: { reason: '用户撤回下班时间', inputs: [{ id: 'end', label: '下班时间', kind: 'fact', value: null, origin: '用户撤回', status: 'withdrawn' }] } }, fixture.db, projectId); };
    await open([...prefix(), ...tail]); await seed(); await start();
    expect(await view()).toMatchObject({ status: 'needs_review', changedInputs: true, request: { inputRevision: 1 } });
  });
  it('第二评审中断并重开 SQLite 后沿原三层树续跑，首评与 prepare 不重复', async () => {
    await open([...prefix(), { throwAfterEvents: new Error('Synthetic source review interruption') }]);
    await seed(); await start();
    expect(await view()).toMatchObject({ status: 'paused' });
    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!active?.pause?.settled || !active.execution_id) throw new Error('Expected settled root pause');
    const original = createResearchJobRepository(fixture.db, projectId).read(requestId);
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.close(); resetAgentRuntimeSingletonsForTest();
    await open(suffix());
    const resumed = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!resumed?.pause?.settled || !resumed.execution_id) throw new Error('Expected reopened settled pause');
    expect(resumed.run_id).toBe(active.run_id);
    await fixture.flow.continueRun(resumed.run_id, { conversation_id: conversationId, expected_execution_id: resumed.execution_id, expected_updated_at: resumed.pause.updated_at }, () => {});
    fixture.ai.assertAllTurnsConsumed();
    expect(await view()).toMatchObject({ status: 'received', request: { id: original.id, runId: original.runId } });
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
    expect(events.filter(event => event.type === 'tool_output' && event.tool_call_id === 'argument-write')).toHaveLength(1);
    expect(createResearchJobRepository(fixture.db, projectId).list(decisionId)).toHaveLength(1);
  });
  it('评审期间取消收口整棵树；保留已存草稿和首评，不认证为完成交付', async () => {
    let entered: (() => void) | undefined;
    const atBoundary = new Promise<void>(resolve => { entered = resolve; });
    beforeRead = async context => {
      if (context.callerAgentId !== 'research_source_review_v1') return;
      entered?.();
      await new Promise<void>((_resolve, reject) => {
        const signal = context.abortSignal;
        if (!signal) throw new Error('Missing child abort signal');
        const abort = () => reject(Object.assign(new Error('Cancelled review read'), { name: 'AbortError' }));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
    };
    await open([...prefix(), read('blocked-review-read', 'source')]); await seed();
    const running = start(); await atBoundary;
    const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!root) throw new Error('Missing root');
    await fixture.flow.cancelRun(root.run_id, conversationId, 'user cancelled test'); await running;
    expect(await view()).toMatchObject({ status: 'cancelled' });
    const job = createResearchJobRepository(fixture.db, projectId).read(requestId);
    expect(job.delivery).toBeUndefined();
    expect((await fixture.runtime.supervisor.list({ conversationId, includeChildren: true })).runs.every(run => run.status === 'completed' || run.status === 'cancelled')).toBe(true);
    expect(await (await createChildRunDeliveryReader({ hostContext: context(), conversationId, projectId, signal: new AbortController().signal })).observeDocument('workspace:/draft.md')).toMatchObject({ versionNumber: 1 });
  });
  it('委派目录和执行同时限制：决策只能调用完整研究，研究不能调用自身，叶子无委派工具', async () => {
    await open([]); await seed();
    const subagent = new SubagentTool();
    const decisionContext = { ...context(), callerAgentId: 'decision_agent', allowedSubagentTypes: ['decision_research'] };
    const researchContext = { ...context(), callerAgentId: 'research_v1', allowedSubagentTypes: ['research_argument_review', 'research_source_review'] };
    expect(subagent.getParametersForContext(decisionContext).properties.subagent_type?.enum).toEqual(['decision_research']);
    await expect(subagent.run({ description: '越权', prompt: 'x', subagent_type: 'general' }, decisionContext)).rejects.toThrow('unknown subagent_type');
    await expect(subagent.run({ description: '递归', prompt: 'x', subagent_type: 'decision_research' }, researchContext)).rejects.toThrow('unknown subagent_type');
    expect(fixture.ai.getCalls()).toHaveLength(0);
  });

  it('无效显式研究范围在 child 接纳前拒绝，不启动模型或留下假委托', async () => {
    await open([tool('invalid-scope', 'subagent', { description: '缺少范围', subagent_type: 'decision_research', prompt: '{}' }), { contentChunks: ['修正范围后再启动。'] }]);
    await seed(); await start(); fixture.ai.assertAllTurnsConsumed();
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
    const rejected = events.find(event => event.type === 'tool_output' && event.tool_call_id === 'invalid-scope');
    expect(rejected).toMatchObject({ status: 'error' });
    expect((await fixture.runtime.supervisor.list({ conversationId, includeChildren: true })).runs).toHaveLength(1);
    expect(createResearchJobRepository(fixture.db, projectId).list(decisionId)).toHaveLength(0);
  });

  it.each(['missing', 'pending'] as const)('材料%s在 prepare 阶段明确拒绝，不启动研究或留下委托', async materialState => {
    await open([tool('prepare-rejected', 'shell', { operation: 'prepare' }), { contentChunks: ['先修正材料，再准备研究。'] }]);
    await seed();
    if (materialState === 'missing') writeFileSync(join(directory, 'scope.json'), JSON.stringify({ ...scope, materials: ['workspace:/missing.md'] }));
    else await new WriteFileTool().run({ locator: 'workspace:/source.md', content: '# 新材料待接受\n\n内容已改。' }, context());
    await start(); fixture.ai.assertAllTurnsConsumed();
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
    expect(events.find(event => event.type === 'tool_output' && event.tool_call_id === 'prepare-rejected'))
      .toMatchObject({ status: 'error', error: expect.stringContaining(materialState === 'missing' ? 'decision.not_found' : 'decision.invalid_model') });
    expect(createResearchJobRepository(fixture.db, projectId).list(decisionId)).toHaveLength(0);
    expect((await fixture.runtime.supervisor.list({ conversationId, includeChildren: true })).runs).toHaveLength(1);
  });

});
