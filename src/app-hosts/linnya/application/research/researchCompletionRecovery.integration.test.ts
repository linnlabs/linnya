import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_AGENT_ID, ResearchRunArgsSchema, type ResearchStage } from '@app/schemas';
import { RunIdSchema, ToolCallIdSchema, runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import type { graph } from '@linnlabs/linnkit/runtime-kernel';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { SQLiteEventStore } from '../../adapters/persistence/event-store';
import { SqliteCheckpointer } from '../../adapters/persistence/checkpointer';
import { SQLiteRunRegistryStore } from '../../adapters/persistence/run-registry';
import { SqliteToolResultReceipts } from '../../adapters/persistence/execution-commit';
import { SqliteRunDescriptorStore } from '../../adapters/persistence/run-descriptors';
import { runnableDefinitionToAgentSpec } from '../../adapters/runtime/agentDefinitionToAgentSpec';
import { createWorkspaceResearchDocumentPort } from '../../adapters/research-documents';
import { SqliteResearchStageReceiptStore } from '../../adapters/persistence/research-stage-receipts';
import { CompleteResearchTool } from '../../adapters/research-execution/CompleteResearchTool';
import { serializeResearchDocumentSubmission } from '../../adapters/research-execution/SubmitResearchDocumentTool';
import { createRunToolRecoveryPort } from '../run-resumption/functions/createRunToolRecoveryPort';
import { RunDescriptorSchema } from '../run-resumption';
import { createResearchDelegationUseCase } from './index';
import type { ResearchExecutionIdentity } from './definitions/researchStageReceipt';

type RecoveryCall = Parameters<graph.ToolRecoveryPort['reconcile']>[0];
let database: DatabaseService;
let identity: ResearchExecutionIdentity;
let events: SQLiteEventStore;
const invocation = ResearchRunArgsSchema.parse({
  question: 'Explain the change.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
});
function documents() {
  return createWorkspaceResearchDocumentPort({ db: database.getDb(), eventStore: events });
}
function useCase() {
  const registry = new SQLiteRunRegistryStore(database.getDb());
  return createResearchDelegationUseCase({
    authoring: 'delegated',
    documents: documents(),
    receipts: new SqliteResearchStageReceiptStore(database.getDb()),
    async childCompleted(subrunId, parentRunId) {
      const child = await registry.load(runIdFromSubrunId(subrunId));
      return child?.parentRunId === parentRunId && child.status === 'completed';
    },
  });
}
function call(name: string, args: object): RecoveryCall {
  return {
    id: ToolCallIdSchema.parse(`${name}-call`),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}
async function executing(run: string, toolCall: RecoveryCall, parentRunId?: string) {
  const runId = RunIdSchema.parse(run);
  // 该用例验证文档/回执 owner 和恢复决定；完整模型与断点循环由 Flow 集成测试负责。
  await new SqliteRunDescriptorStore(database.getDb()).insert(
    RunDescriptorSchema.parse({
      schemaVersion: 1,
      runId,
      conversationId: identity.conversationId,
      turnId: `turn-${runId}`,
      createdAt: 1,
      agentSpec: runnableDefinitionToAgentSpec({
        id: 'receipt-fixture',
        promptKey: 'receipt-fixture',
        defaultMode: 'agent',
        description: 'Receipt owner fixture',
      }),
      request: {
        query: 'Receipt recovery',
        promptKey: 'receipt-fixture',
        frozenSystemPrompt: 'No model is invoked by this receipt fixture.',
      },
      historyEventIds: [],
      incomingEventIds: [],
      runContext: { runId, traceId: 'receipt-trace', tags: {} },
      toolContextPatch: {},
      executorLocal: {},
      commandPermission: {
        status: 'unavailable',
        code: 'permission_settings_unavailable',
        reason: 'run_snapshot_missing',
      },
      compatibility: {
        hostVersion: 'test',
        frameworkVersion: 'test',
        agentConfiguration: {},
        models: {},
        plugins: [],
        skills: {},
      },
    })
  );
  const registry = new SQLiteRunRegistryStore(database.getDb());
  await registry.save({
    runId,
    conversationId: identity.conversationId,
    parentRunId: parentRunId ? RunIdSchema.parse(parentRunId) : undefined,
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    metadata: { executionId: 'attempt' },
  });
  await new SqliteCheckpointer(database.getDb()).save(runId, {
    nodeId: 'tool',
    revision: 1,
    executionStatus: 'executing',
    local: { pendingToolCalls: [toolCall], executingToolCallId: toolCall.id },
  });
  return new SqliteToolResultReceipts(database.getDb()).forExecution(runId, 'attempt');
}
function recovery(runId: string) {
  const receipts = new SqliteToolResultReceipts(database.getDb());
  return createRunToolRecoveryPort({ read: (id, name) => receipts.read(runId, id, name) });
}
async function stage(name: ResearchStage, input: string[]) {
  const prepared = await useCase().prepare({
    identity: { ...identity, toolCallId: name },
    invocation,
    stage: name,
    instructions: `Save the ${name} document.`,
    documents: input,
  });
  const runId = runIdFromSubrunId(prepared.prepared.subrunId);
  await events.beginRunSession(identity.conversationId, runId, { kind: 'agent' });
  const submitCall = call('submit_research_document', { content: `# ${name}\n\n100 became 110.` });
  const receipt = await executing(runId, submitCall, identity.parentRunId);
  const artifact = await prepared.session.submit({
    sourceRunId: runId,
    content: `# ${name}\n\n100 became 110.`,
    resultCommit: {
      prepare: () => receipt.prepare(submitCall.id, 'submit_research_document'),
      commit: value =>
        receipt.commit(
          submitCall.id,
          'submit_research_document',
          serializeResearchDocumentSubmission(value)
        ),
    },
  });
  const registry = new SQLiteRunRegistryStore(database.getDb());
  const record = await registry.load(runId);
  if (!record) throw new Error('Expected admitted child');
  await registry.save({ ...record, status: 'completed' });
  await prepared.session.accept(artifact);
  return { path: artifact.path, runId, submitCall };
}

beforeEach(async () => {
  database = new DatabaseService(':memory:');
  database.initialize();
  const projectId = new WorkspaceService(database.getDb()).createProject('Recovery research');
  events = new SQLiteEventStore(database.getDb());
  identity = {
    projectId,
    conversationId: 'completion-recovery',
    parentRunId: 'research-root',
    toolCallId: 'complete_research-call',
    modelId: 'fixture',
  };
  await events.ensureConversation(identity.conversationId, [], projectId, 'agent');
  await events.beginRunSession(identity.conversationId, identity.parentRunId, { kind: 'agent' });
  await documents().save({
    projectId,
    conversationId: identity.conversationId,
    sourceRunId: identity.parentRunId,
    path: 'workspace:/source.md',
    text: '# Source\n\n100 became 110.',
    receipt: { prepare() {}, commit() {} },
  });
});
afterEach(() => database.close());

describe('research delivery recovery with durable tool receipts', () => {
  it('rechecks current source versions after a returned completion receipt while replaying atomic document submissions', async () => {
    const investigation = await stage('investigation', []);
    const review = await stage('investigation_review', [investigation.path]);
    const draft = await stage('draft', [investigation.path, review.path]);
    const argument = await stage('argument_review', [investigation.path, draft.path]);
    const source = await stage('source_review', [investigation.path, draft.path]);
    const revision = await stage('revision', [
      investigation.path,
      draft.path,
      argument.path,
      source.path,
    ]);
    const completeCall = call('complete_research', { document: revision.path });
    const returned = await executing(identity.parentRunId, completeCall);
    const tool = new CompleteResearchTool();
    const context = {
      runId: RunIdSchema.parse(identity.parentRunId),
      conversationId: identity.conversationId,
      callerAgentId: RESEARCH_AGENT_ID,
      researchCompletion: (locator: string) => useCase().complete(identity, locator),
    };
    const originalResult = await tool.run({ document: revision.path }, context);
    returned.returned(completeCall.id, 'complete_research', originalResult);
    expect(
      new SqliteToolResultReceipts(database.getDb()).read(
        identity.parentRunId,
        completeCall.id,
        'complete_research'
      )
    ).toMatchObject({ result: originalResult, atomic_owner: 0 });

    // 恢复先重新核对；未变化时结果保持相同，不能为读检查创建任何新文稿。
    expect(await recovery(identity.parentRunId).reconcile(completeCall, context)).toEqual({
      kind: 'retry',
    });
    expect(await tool.run({ document: revision.path }, context)).toBe(originalResult);
    const input = await documents().read({
      projectId: identity.projectId,
      locator: 'workspace:/source.md',
    });
    new MarkdownDocumentService(database.getDb()).saveNewVersion(
      input.inode.slice('workspace:'.length),
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'rootBlock',
            attrs: { id: 'user-root' },
            content: [
              {
                type: 'baseBlock',
                attrs: { id: 'user-base' },
                content: [{ type: 'text', text: 'User changed the source.' }],
              },
            ],
          },
        ],
      })
    );
    expect(await recovery(identity.parentRunId).reconcile(completeCall, context)).toEqual({
      kind: 'retry',
    });
    await expect(tool.run({ document: revision.path }, context)).rejects.toMatchObject({
      paths: ['workspace:/source.md'],
    });

    // 已提交的文稿是原子写入事实，恢复只取原结果；输入失效不能导致重新写稿。
    const savedSubmit = new SqliteToolResultReceipts(database.getDb()).read(
      revision.runId,
      revision.submitCall.id,
      'submit_research_document'
    );
    expect(savedSubmit?.atomic_owner).toBe(1);
    expect(await recovery(revision.runId).reconcile(revision.submitCall, {})).toEqual({
      kind: 'settled',
      result: { success: true, result: savedSubmit?.result, durationMs: 0 },
    });
    expect(new SqliteResearchStageReceiptStore(database.getDb()).listRun(identity)).toHaveLength(6);
  });
});
