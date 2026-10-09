import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema, type ResearchStage } from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { SQLiteEventStore } from '../../adapters/persistence/event-store';
import { createWorkspaceResearchDocumentPort } from '../../adapters/research-documents';
import { SqliteResearchStageReceiptStore } from '../../adapters/persistence/research-stage-receipts';
import { createResearchDelegationUseCase } from './index';
import type { ResearchExecutionIdentity } from './definitions/researchStageReceipt';

let database: DatabaseService;
let identity: ResearchExecutionIdentity;
let events: SQLiteEventStore;
const completed = new Set<string>();
const invocation = ResearchRunArgsSchema.parse({
  question: 'Explain a change without assuming its cause.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
});
function docs() {
  return createWorkspaceResearchDocumentPort({ db: database.getDb(), eventStore: events });
}
function store() {
  return new SqliteResearchStageReceiptStore(database.getDb());
}
function useCase() {
  return createResearchDelegationUseCase({
    documents: docs(),
    receipts: store(),
    childCompleted: async subrunId => completed.has(subrunId),
  });
}
async function prepare(stage: ResearchStage, documents: string[], call = stage) {
  return useCase().prepare({
    identity: { ...identity, toolCallId: call },
    invocation,
    stage,
    instructions: `Investigate and save ${stage}.`,
    documents,
  });
}
async function stage(name: ResearchStage, documents: string[], call: string = name) {
  const current = await prepare(name, documents, call);
  const child = `run-${current.prepared.subrunId}`;
  await events.beginRunSession(identity.conversationId, child, { kind: 'agent' });
  const artifact = await current.session.submit({
    sourceRunId: child,
    content: `# ${name}\n\nThe source reports 100 becoming 110. The cause is unresolved.`,
    resultCommit: { prepare() {}, commit() {} },
  });
  completed.add(current.prepared.subrunId);
  await current.session.accept(artifact);
  return artifact.path;
}
async function chain() {
  const investigation = await stage('investigation', []);
  const review = await stage('investigation_review', [investigation]);
  const draft = await stage('draft', [investigation, review]);
  const argument = await stage('argument_review', [investigation, draft]);
  const source = await stage('source_review', [investigation, draft]);
  const revision = await stage('revision', [investigation, draft, argument, source]);
  return { investigation, review, draft, argument, source, revision };
}
beforeEach(async () => {
  completed.clear();
  database = new DatabaseService(':memory:');
  database.initialize();
  const projectId = new WorkspaceService(database.getDb()).createProject('Delegated research');
  events = new SQLiteEventStore(database.getDb());
  await events.ensureConversation('delegation-conversation', [], projectId, 'agent');
  await events.beginRunSession('delegation-conversation', 'delegation-parent', { kind: 'agent' });
  identity = {
    projectId,
    conversationId: 'delegation-conversation',
    parentRunId: 'delegation-parent',
    toolCallId: 'completion',
    modelId: 'fixture',
  };
  await docs().save({
    projectId,
    conversationId: identity.conversationId,
    sourceRunId: identity.parentRunId,
    path: 'workspace:/source.md',
    text: '# Source\n\n100 became 110.',
    receipt: { prepare() {}, commit() {} },
  });
});
afterEach(() => database.close());

describe('Lead-selected research handoff with real Workspace and receipts', () => {
  it('每次只准备主Agent选择的一项任务，完整链交付后可以从原回执复取', async () => {
    const result = await chain();
    expect(store().listRun(identity)).toHaveLength(6);
    const delivery = await useCase().complete(identity, result.revision);
    expect(delivery.artifact.path).toBe(result.revision);
    expect(delivery.review_artifacts.map(item => item.stage)).toEqual([
      'argument_review',
      'source_review',
    ]);
    const resumed = await prepare('investigation', []);
    expect(resumed.prepared.artifact?.locator).toBe(result.investigation);
    await expect(
      resumed.session.submit({
        sourceRunId: 'unused',
        content: '# duplicate',
        resultCommit: { prepare() {}, commit() {} },
      })
    ).rejects.toThrow('already submitted');
    await expect(
      useCase().prepare({
        identity: { ...identity, toolCallId: 'investigation' },
        invocation,
        stage: 'investigation',
        instructions: 'Different task',
        documents: [],
      })
    ).rejects.toThrow('Cannot change');
    expect(store().listRun(identity)).toHaveLength(6);
  });
  it('未完成child与未复核初稿不能伪装成交付；两评审不可互读', async () => {
    const investigation = await stage('investigation', []);
    completed.clear();
    await expect(prepare('investigation_review', [investigation])).rejects.toThrow('not completed');
    completed.add('investigation_investigation');
    const review = await stage('investigation_review', [investigation]);
    const draft = await stage('draft', [investigation, review]);
    const argument = await stage('argument_review', [investigation, draft]);
    await expect(prepare('source_review', [investigation, draft, argument])).rejects.toThrow(
      'must not receive'
    );
    await expect(prepare('revision', [investigation, draft, argument])).rejects.toThrow(
      'source_review'
    );
    await expect(useCase().complete(identity, draft)).rejects.toThrow('Select a revision');
  });
  it('旧评审不能用于另一版初稿，固定范围不能引入旁路文件', async () => {
    const current = await chain();
    const anotherDraft = await stage(
      'draft',
      [current.investigation, current.review],
      'another-draft'
    );
    await expect(
      prepare(
        'revision',
        [current.investigation, anotherDraft, current.argument, current.source],
        'bad-revision'
      )
    ).rejects.toThrow('exact supplied draft');
    await docs().save({
      projectId: identity.projectId,
      conversationId: identity.conversationId,
      sourceRunId: identity.parentRunId,
      path: 'workspace:/outside.md',
      text: '# Outside\n\nExcluded.',
      receipt: { prepare() {}, commit() {} },
    });
    await expect(
      prepare('investigation', ['workspace:/outside.md'], 'outside-call')
    ).rejects.toThrow('Fixed research');
  });
  it('用户改动祖先材料后，最终交付与原工具恢复均失败而不覆盖用户稿', async () => {
    const current = await chain();
    const source = await docs().read({
      projectId: identity.projectId,
      locator: 'workspace:/source.md',
    });
    const owner = new MarkdownDocumentService(database.getDb());
    owner.saveNewVersion(
      source.inode.slice('workspace:'.length),
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'rootBlock',
            attrs: { id: 'changed-root' },
            content: [
              {
                type: 'baseBlock',
                attrs: { id: 'changed-base' },
                content: [{ type: 'text', text: 'User changed the source.' }],
              },
            ],
          },
        ],
      })
    );
    await expect(useCase().complete(identity, current.revision)).rejects.toMatchObject({
      paths: ['workspace:/source.md'],
    });
    await expect(prepare('investigation', [])).rejects.toMatchObject({
      paths: ['workspace:/source.md'],
    });
    expect(
      (await docs().read({ projectId: identity.projectId, inode: source.inode })).text
    ).toContain('User changed');
  });
  it('取消不写稿，空稿拒绝后原阶段可以修正提交', async () => {
    const current = await prepare('investigation', []);
    const args = {
      sourceRunId: identity.parentRunId,
      content: ' ',
      resultCommit: { prepare() {}, commit() {} },
    };
    await expect(current.session.submit(args)).rejects.toThrow('不能保存空稿');
    const abort = new AbortController();
    abort.abort();
    await expect(
      current.session.submit({ ...args, content: '# valid', signal: abort.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const artifact = await current.session.submit({
      ...args,
      content: '# Corrected\n\nStill unverified.',
    });
    expect(artifact.stage).toBe('investigation');
    expect(store().listRun(identity)).toHaveLength(1);
  });
});
