import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunIdSchema, type AgentSpec } from '@linnlabs/linnkit/contracts';
import { execution, graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { ConversationAttentionNotification, ConversationExternalSender } from '@app/schemas';
import { parseCommandApprovalRequest } from '@app/schemas/commands';
import { DatabaseService } from 'src/electron-main/services/database';
import { createCommandApprovalHost } from '../../../adapters/commands/approval-host';
import { subscribeRunActivity } from '../../../adapters/persistence/run-activity-signal';
import {
  createConversationActivityPorts,
  createRunExternalSenderReader,
  SQLiteRunRegistryStore,
} from '../../../adapters/persistence/run-registry';
import { listConversationActivities } from '../../conversation-activity';
import { connectExternalRunAttention } from '..';

/**
 * 用真实的运行登记、审批 owner 和数据库走一遍：只替换“把提醒交给桌面”这一步。
 * 检查合并延迟是 50 ms，用真实计时器等它落定。
 */
let database: DatabaseService;
let supervisor: runSupervisor.DefaultRunSupervisor;
let approvals: ReturnType<typeof createCommandApprovalHost>;
let notices: ConversationAttentionNotification[];
let errors: string[];
let disconnect: () => void;
let failNotify = false;
const agentSpec: AgentSpec = { id: 'attention-agent', version: '1.0.0', role: 'agent', capabilities: ['agent'], tools: [], contextPolicy: { profileId: 'agent' } };
const settle = () => new Promise(resolve => setTimeout(resolve, 120));

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  const db = database.getDb();
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('project-1', '交稿', 1, 1)").run();
  const insertConversation = db.prepare(
    "INSERT INTO conversations (conversation_id, title, project_id, created_at, last_event_at) VALUES (?, ?, 'project-1', 1, 1)",
  );
  insertConversation.run('cli-conversation', 'Linnya CLI · 2026-11-28 12:27');
  insertConversation.run('ui-conversation', '用户自己的对话');
  supervisor = new runSupervisor.DefaultRunSupervisor({ registryStore: new SQLiteRunRegistryStore(db) });
  approvals = createCommandApprovalHost();
  approvals.setControlEndpointAvailable(true);
  notices = [];
  errors = [];
  failNotify = false;
  const activity = createConversationActivityPorts(db, approvals);
  disconnect = connectExternalRunAttention({
    subscribe: listener => {
      const unsubscribeRuns = subscribeRunActivity(db, listener);
      const unsubscribeApprovals = approvals.subscribe(listener);
      return () => { unsubscribeRuns(); unsubscribeApprovals(); };
    },
    ports: {
      listActivities: () => listConversationActivities(activity),
      readExternalSender: createRunExternalSenderReader(db),
      readConversationTitle: async conversationId => (
        db.prepare<[string], { title: string }>('SELECT title FROM conversations WHERE conversation_id = ?').get(conversationId)?.title ?? null
      ),
      notify: async notification => {
        if (failNotify) throw new Error('desktop unavailable');
        notices.push(notification);
      },
      logError: message => { errors.push(message); },
    },
  });
});
afterEach(async () => {
  disconnect();
  approvals.endOwner();
  await supervisor.drain({ timeoutMs: 100 });
  database.close();
  vi.restoreAllMocks();
});

/** 对话流程接纳外部入口的请求时把发件人写进运行元数据；界面发起的运行没有这一项。 */
async function register(id: string, conversationId: string, externalSender?: ConversationExternalSender) {
  const handle = await supervisor.registerRun({
    runId: RunIdSchema.parse(id), conversationId, agentSpec, request: { query: 'fixture' },
    eventBus: new execution.EventBus(`event-${id}`), eventStore: new graph.MemoryEventStore(),
    costCollector: { snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }) },
    metadata: { lane: 'foreground', executionId: `execution-${id}`, turnId: `turn-${id}`, ...(externalSender ? { externalSender } : {}) },
  });
  await handle.markRunning();
  return handle;
}

function approvalRequest(conversationId: string, runId: string, suffix: string) {
  const identity = { conversation_id: conversationId, agent_run_id: runId, origin_tool_call_id: `call-${suffix}`,
    command_execution_id: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${suffix}`,
    owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b', created_at_ms: 1 };
  return parseCommandApprovalRequest({ protocol_version: 1, kind: 'command_approval_request',
    approval_request_id: `command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${suffix}`,
    proposal: { protocol_version: 1, kind: 'shell_command_proposal', identity, command: 'rm fixture.txt', cwd: '/tmp',
      permission: { protocol_version: 1, kind: 'command_permission_snapshot', identity, base_level: 'standard', effective_level: 'standard', grant_source: 'global_setting', internal_data_access: 'allowed' } },
    reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.file', category: 'delete' }], available_choices: ['allow_once', 'deny'], requested_at_ms: 2 });
}

it('外部 Agent 发起的运行等批准时提醒一次；批完再次等批准会再提醒；用户自己发起的运行不提醒', async () => {
  const external = await register('cli-run', 'cli-conversation', { entry: 'linnya_cli', name: 'Codex' });
  const own = await register('ui-run', 'ui-conversation');
  await settle();
  expect(notices).toEqual([]);

  const first = approvalRequest('cli-conversation', external.runId, '1');
  const firstReply = approvals.request({ request: first });
  const ownApproval = approvalRequest('ui-conversation', own.runId, '2');
  const ownReply = approvals.request({ request: ownApproval });
  await settle();
  expect(notices).toEqual([{
    kind: 'awaiting_approval',
    conversation_id: 'cli-conversation',
    project_id: 'project-1',
    conversation_title: 'Linnya CLI · 2026-11-28 12:27',
    sender: { entry: 'linnya_cli', name: 'Codex' },
  }]);

  // 同一段等待里别的变化（另一个对话的审批结束）不重复提醒。
  approvals.submitControlReply({ conversationId: 'ui-conversation', runId: own.runId, approvalRequestId: ownApproval.approval_request_id, choice: 'deny' });
  await ownReply;
  await settle();
  expect(notices).toHaveLength(1);

  // 用户批了，运行继续；之后又遇到一条要批准的命令，是新的一段等待。
  approvals.submitControlReply({ conversationId: 'cli-conversation', runId: external.runId, approvalRequestId: first.approval_request_id, choice: 'allow_once' });
  await firstReply;
  await settle();
  const second = approvalRequest('cli-conversation', external.runId, '3');
  const secondReply = approvals.request({ request: second });
  await settle();
  expect(notices.map(notice => notice.kind)).toEqual(['awaiting_approval', 'awaiting_approval']);

  approvals.submitControlReply({ conversationId: 'cli-conversation', runId: external.runId, approvalRequestId: second.approval_request_id, choice: 'deny' });
  await secondReply;
  expect(errors).toEqual([]);
});

it('没报名称的命令行调用等回答时也提醒；桌面通知发不出去只记错误，下一段等待照常提醒', async () => {
  const unnamed = await register('cli-question', 'cli-conversation', { entry: 'linnya_cli' });
  failNotify = true;
  await unnamed.markAwaitingUser();
  await settle();
  expect(notices).toEqual([]);
  expect(errors).toEqual(['External run attention notification unavailable']);

  failNotify = false;
  await unnamed.markCompleted();
  const next = await register('cli-question-2', 'cli-conversation', { entry: 'linnya_cli' });
  await next.markAwaitingUser();
  await settle();
  expect(notices).toMatchObject([{ kind: 'awaiting_answer', conversation_id: 'cli-conversation', sender: { entry: 'linnya_cli' } }]);
  expect(notices[0]?.sender).not.toHaveProperty('name');
});
