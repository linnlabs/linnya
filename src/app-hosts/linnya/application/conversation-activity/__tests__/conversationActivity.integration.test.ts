import { afterEach, beforeEach, expect, it } from 'vitest';
import { ExecutionIdSchema, RunIdSchema, ToolCallIdSchema, type AgentSpec } from '@linnlabs/linnkit/contracts';
import { execution, graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { parseCommandApprovalRequest } from '@app/schemas/commands';
import { DatabaseService } from 'src/electron-main/services/database';
import { createConversationActivityPorts, SQLiteRunRegistryStore } from '../../../adapters/persistence/run-registry';
import { createCommandApprovalHost } from '../../../adapters/commands/approval-host';
import { readConversationActivity } from '..';

let database: DatabaseService;
let registry: SQLiteRunRegistryStore;
let supervisor: runSupervisor.DefaultRunSupervisor;
let approvals: ReturnType<typeof createCommandApprovalHost>;
const conversationId = 'activity-conversation';
const agentSpec: AgentSpec = { id: 'activity-agent', version: '1.0.0', role: 'agent', capabilities: ['agent'], tools: [], contextPolicy: { profileId: 'agent' } };
const read = () => readConversationActivity(createConversationActivityPorts(database.getDb(), approvals), conversationId);

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  database.getDb().prepare('INSERT INTO conversations (conversation_id, title, created_at, last_event_at) VALUES (?, ?, 1, 1)')
    .run(conversationId, 'activity');
  registry = new SQLiteRunRegistryStore(database.getDb());
  supervisor = new runSupervisor.DefaultRunSupervisor({ registryStore: registry });
  approvals = createCommandApprovalHost();
  approvals.setControlEndpointAvailable(true);
});
afterEach(async () => { approvals.endOwner(); await supervisor.drain({ timeoutMs: 100 }); database.close(); });

async function register(id: string, parentRunId?: string, lane = 'foreground') {
  const handle = await supervisor.registerRun({
    runId: RunIdSchema.parse(id), conversationId, agentSpec, request: { query: 'fixture' },
    ...(parentRunId ? { parentRunId: RunIdSchema.parse(parentRunId) } : {}),
    eventBus: new execution.EventBus(`event-${id}`), eventStore: new graph.MemoryEventStore(),
    costCollector: { snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }) },
    metadata: { lane, executionId: `execution-${id}`, turnId: `turn-${id}` },
  });
  await handle.markRunning();
  return handle;
}

it('真实 registry 生命周期：等待回答、回答后恢复、中断收口、恢复与取消不被只读查询清除', async () => {
  expect(await read()).toMatchObject({ state: 'idle', source: 'none', run_id: null });
  const handle = await register('root');
  expect(await read()).toMatchObject({ state: 'running', run_id: 'root' });
  const interaction = { interactionId: 'question', toolCallId: ToolCallIdSchema.parse('question-tool'), checkpointRevision: 1, resumeToken: 'resume' };
  await handle.markAwaitingUser({ interaction, eventId: 'question-event' });
  expect(await read()).toMatchObject({ state: 'awaiting_answer', run_status: 'awaiting_user' });
  const claim = await supervisor.claimResume(handle.runId, interaction, new execution.EventBus('answer'));
  const answering = await claim.activate({ executionId: ExecutionIdSchema.parse('answer-execution') });
  expect(await read()).toMatchObject({ state: 'running', run_id: 'root' });
  await answering.pause('user_pause');
  expect(await read()).toMatchObject({ state: 'running', pause: { settled: false } });
  await answering.markPaused();
  expect(await read()).toMatchObject({ state: 'interrupted', reason: 'paused', pause: { settled: true, reason: 'user_pause' } });
  const snapshot = await registry.load(handle.runId);
  if (!snapshot) throw new Error('run disappeared');
  const resumed = await supervisor.resumePausedRun({ runId: handle.runId, expectedUpdatedAt: snapshot.updatedAt,
    expectedExecutionId: ExecutionIdSchema.parse('answer-execution'), executionId: ExecutionIdSchema.parse('resumed-execution'), eventBus: new execution.EventBus('resumed') });
  expect(await read()).toMatchObject({ state: 'running', run_id: 'root' });
  await resumed.cancel({ reason: 'user_cancel' });
  expect(await read()).toMatchObject({ state: 'interrupted', reason: 'cancelled', run_status: 'cancelled' });
  expect(await read()).toEqual(await read());
  const completed = await register('next-root');
  await completed.markCompleted();
  expect(await read()).toMatchObject({ state: 'idle', run_id: 'next-root', run_status: 'completed' });
});

it('真实 Commands pending：root 后代审批优先，已回复 processing 不再等待，不相关后台审批不混入', async () => {
  const root = await register('approval-root');
  const child = await register('approval-child', root.runId);
  const background = await register('background', undefined, 'auxiliary');
  function request(runId: string, suffix: string) {
    const identity = { conversation_id: conversationId, agent_run_id: runId, origin_tool_call_id: `call-${suffix}`,
      command_execution_id: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${suffix}`,
      owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b', created_at_ms: 1 };
    return parseCommandApprovalRequest({ protocol_version: 1, kind: 'command_approval_request',
      approval_request_id: `command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${suffix}`,
      proposal: { protocol_version: 1, kind: 'shell_command_proposal', identity, command: 'rm fixture.txt', cwd: '/tmp',
        permission: { protocol_version: 1, kind: 'command_permission_snapshot', identity, base_level: 'standard', effective_level: 'standard', grant_source: 'global_setting', internal_data_access: 'allowed' } },
      reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.file', category: 'delete' }], available_choices: ['allow_once', 'deny'], requested_at_ms: 2 });
  }
  const unrelated = request(background.runId, '1');
  const unrelatedResponse = approvals.request({ request: unrelated });
  expect(await read()).toMatchObject({ state: 'running', pending_approval_count: 0 });
  const approval = request(child.runId, '2');
  const response = approvals.request({ request: approval });
  await root.markAwaitingUser();
  expect(await read()).toMatchObject({ state: 'awaiting_approval', pending_approval_count: 1 });
  approvals.submitControlReply({ conversationId, runId: child.runId, approvalRequestId: approval.approval_request_id, choice: 'deny' });
  await expect(response).resolves.toMatchObject({ status: 'replied' });
  expect(await read()).toMatchObject({ state: 'awaiting_answer', pending_approval_count: 0 });
  approvals.setControlEndpointAvailable(false);
  expect(await read()).toMatchObject({ state: 'unavailable', reason: 'approval_unavailable', pending_approval_count: null });
  await root.markFailed({ errorCode: 'model_error', message: 'failure', recoverable: false });
  expect(await read()).toMatchObject({ state: 'interrupted', reason: 'failed', pending_approval_count: 0 });
  approvals.endOwner();
  await unrelatedResponse;
});


it('批量轻投影保留较早活跃根、最新终态及当前后代，不按最新时间冒认；多个活跃根仍报错', async () => {
  const old = await register('old-terminal');
  const obsoleteChild = await register('obsolete-child', old.runId);
  await old.markCompleted();
  await obsoleteChild.markCompleted();
  const active = await register('older-active');
  const child = await register('active-child', active.runId);
  const recent = await register('newer-completed');
  await recent.markCompleted();
  const recentRecord = await registry.load(recent.runId);
  if (!recentRecord) throw new Error('fixture run disappeared');
  await registry.save({ ...recentRecord, updatedAt: recentRecord.updatedAt + 100 });
  await register('unrelated-background', undefined, 'auxiliary');
  const ports = createConversationActivityPorts(database.getDb(), approvals);
  const candidates = await ports.runs.readCandidates([conversationId, 'absent']);
  expect(candidates.has('absent')).toBe(false);
  expect(candidates.get(conversationId)?.map(run => run.runId).sort()).toEqual([
    child.runId, recent.runId, active.runId,
  ].sort());
  expect(await read()).toMatchObject({ state: 'running', run_id: active.runId });
  await register('conflicting-active');
  await expect(read()).rejects.toThrow('multiple active foreground runs');
});
