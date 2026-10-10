import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema, WebSearchResultSchema, type ResearchStage } from '@app/schemas';
import { createToolOutputEvent, routeRuntimeEvent, RunIdSchema } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { SQLiteEventStore, type RunSession } from '../../adapters/persistence/event-store';
import { createWorkspaceResearchDocumentPort } from '../../adapters/research-documents';
import { SqliteResearchStageReceiptStore } from '../../adapters/persistence/research-stage-receipts';
import { createResearchDelegationUseCase } from './index';
import type { ResearchExecutionIdentity } from './definitions/researchStageReceipt';

let database: DatabaseService;
let identity: ResearchExecutionIdentity;
let events: SQLiteEventStore;
let parentSession: RunSession;
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
function useCase(authoring: 'parent' | 'delegated' = 'delegated') {
  return createResearchDelegationUseCase({
    authoring,
    documents: docs(),
    receipts: store(),
    childCompleted: async subrunId => completed.has(subrunId),
  });
}
async function prepare(stage: ResearchStage, documents: string[], call: string = stage) {
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
  const child = current.prepared.subrunId;
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
  parentSession = await events.beginRunSession('delegation-conversation', 'delegation-parent', { kind: 'agent' });
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
    await expect(
      prepare(
        'revision',
        [result.investigation, result.draft, result.argument, result.source],
        'again'
      )
    ).rejects.toThrow('one revision');
  });
  it('未完成child与未复核初稿不能伪装成交付；两评审不可互读', async () => {
    const investigation = await stage('investigation', []);
    completed.clear();
    await expect(prepare('investigation_review', [investigation])).rejects.toThrow('not completed');
    const original = store().list({ ...identity, toolCallId: 'investigation' })[0];
    if (!original || 'runId' in original) throw new Error('Missing original investigation');
    completed.add(original.subrunId);
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
    const investigation = await stage('investigation', []);
    const review = await stage('investigation_review', [investigation]);
    const draft = await stage('draft', [investigation, review]);
    const argument = await stage('argument_review', [investigation, draft]);
    const source = await stage('source_review', [investigation, draft]);
    const current = { investigation, review, draft, argument, source };
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
    const otherInvestigation = await stage('investigation', [], 'followup');
    const mismatchedReview = await stage(
      'source_review',
      [otherInvestigation, draft],
      'other-review'
    );
    await expect(
      prepare('revision', [investigation, draft, argument, mismatchedReview], 'mismatched-context')
    ).rejects.toThrow('identical draft and source context');
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
    await expect(prepare('investigation', [], 'new-call')).rejects.toMatchObject({
      code: 'RESEARCH_INPUTS_CHANGED',
      paths: ['workspace:/source.md'],
    });
    expect(
      (await docs().read({ projectId: identity.projectId, inode: source.inode })).text
    ).toContain('User changed');
  });
  it('不同根运行使用相同provider工具ID时不共享child，原调用恢复仍稳定', async () => {
    const first = await prepare('investigation', []);
    const otherIdentity = {
      ...identity,
      parentRunId: 'another-parent',
      toolCallId: 'investigation',
    };
    await events.beginRunSession(identity.conversationId, otherIdentity.parentRunId, {
      kind: 'agent',
    });
    const second = await useCase().prepare({
      identity: otherIdentity,
      invocation,
      stage: 'investigation',
      instructions: 'Investigate and save investigation.',
      documents: [],
    });
    expect(second.prepared.subrunId).not.toBe(first.prepared.subrunId);
    expect((await prepare('investigation', [])).prepared.subrunId).toBe(first.prepared.subrunId);
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

async function parentStage(
  name: 'investigation' | 'draft' | 'revision',
  documents: string[],
  call: string = `parent-${name}`
) {
  return useCase('parent').prepareParent({
    identity: { ...identity, toolCallId: call },
    invocation,
    stage: name,
    documents,
  });
}
async function parentArticle(name: 'investigation' | 'draft' | 'revision', documents: string[]) {
  const current = await parentStage(name, documents);
  return current.session.submit({
    sourceRunId: identity.parentRunId,
    content: `# ${name}\n\n100 became 110. This alone cannot establish causation.`,
    resultCommit: { prepare() {}, commit() {} },
  });
}

describe('Parent-owned authorship with independent reviews', () => {
  it('父保持运行即可保存三份稿，两份真实独立复核绑定同一初稿，不强制调查子任务', async () => {
    const investigation = await parentArticle('investigation', []);
    const draft = await parentArticle('draft', [investigation.path]);
    const argument = await stage('argument_review', [investigation.path, draft.path]);
    const source = await stage('source_review', [investigation.path, draft.path]);
    const revision = await parentArticle('revision', [
      investigation.path,
      draft.path,
      argument,
      source,
    ]);
    expect(investigation).toHaveProperty('run_id', identity.parentRunId);
    expect(draft).toHaveProperty('run_id', identity.parentRunId);
    expect(revision).toHaveProperty('run_id', identity.parentRunId);
    const delivered = await useCase('parent').complete(identity, revision.path);
    expect(delivered.artifact).toEqual(revision);
    expect(delivered.review_artifacts.every(item => 'subrun_id' in item)).toBe(true);
    expect(completed.size).toBe(2);
    expect(store().listRun(identity)).toHaveLength(5);
    await expect(
      parentStage(
        'revision',
        [investigation.path, draft.path, argument, source],
        'another-revision'
      )
    ).rejects.toThrow('already submitted');
    await expect(
      useCase('parent').prepare({
        identity,
        invocation,
        stage: 'draft',
        instructions: 'Write my article',
        documents: [investigation.path],
      })
    ).rejects.toThrow('lead Agent writes');
    await expect(parentStage('draft', [investigation.path], 'parent-draft')).resolves.toMatchObject(
      { prepared: { artifact: { inode: draft.inode } } }
    );
  });
  it('拒绝以局部调查冒充主调查、漏评审、改变同调用依赖或旧根突然取得写作权限', async () => {
    const helper = await stage('investigation', []);
    await expect(parentStage('draft', [helper])).rejects.toThrow(
      'lead Agent’s saved investigation'
    );
    const own = await parentArticle('investigation', [helper]);
    const draft = await parentArticle('draft', [own.path]);
    const argument = await stage('argument_review', [own.path, draft.path]);
    await expect(parentStage('revision', [own.path, draft.path, argument])).rejects.toThrow(
      'source_review'
    );
    await expect(parentStage('draft', [helper], 'parent-draft')).rejects.toThrow('Cannot change');
    await expect(
      useCase().prepareParent({ identity, invocation, stage: 'revision', documents: [] })
    ).rejects.toThrow('delegates authorship');
  });
  it('失败或取消的父提交不耗掉一次成文；并发同阶段提交只保存一份，结果回执失败整笔回滚', async () => {
    const first = await parentStage('investigation', [], 'bad-format');
    const submission = {
      sourceRunId: identity.parentRunId,
      content: ' ',
      resultCommit: { prepare() {}, commit() {} },
    };
    await expect(first.session.submit(submission)).rejects.toThrow('不能保存空稿');
    const abort = new AbortController();
    abort.abort();
    await expect(
      first.session.submit({ ...submission, content: '# valid', signal: abort.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const next = await parentStage('investigation', [], 'corrected-format');
    await expect(
      next.session.submit({
        ...submission,
        content: '# valid',
        resultCommit: {
          prepare() {},
          commit() {
            throw new Error('receipt interrupted');
          },
        },
      })
    ).rejects.toThrow('receipt interrupted');
    expect(
      store()
        .listRun(identity)
        .filter(item => item.receipt.artifact)
    ).toHaveLength(0);
    expect(
      new WorkspaceService(database.getDb()).getChildNodes(null, identity.projectId)
    ).toHaveLength(1);
    const corrected = await parentStage('investigation', [], 'corrected-again');
    const result = await Promise.allSettled([
      next.session.submit({ ...submission, content: '# One' }),
      corrected.session.submit({ ...submission, content: '# Two' }),
    ]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect(
      store()
        .listRun(identity)
        .filter(item => item.receipt.artifact)
    ).toHaveLength(1);
    expect(
      new WorkspaceService(database.getDb()).getChildNodes(null, identity.projectId)
    ).toHaveLength(2);
  });
  it('父稿只消费真实父运行取得的Citation，同会话child的裸ref不能替代正式读取', async () => {
    const evidence = WebSearchResultSchema.parse({
      data: {
        query: 'fixture',
        resultCount: 1,
        citations: {
          query: 'fixture',
          searchMode: 'web',
          citations: [
            {
              ref: 'Abc234',
              index: 1,
              sourceType: 'web',
              url: 'https://example.com/source',
              docTitle: 'Source',
              snippet: '100 became 110',
            },
          ],
        },
        evidence_store: { bundle_id: '0123456789abcdef' },
        cacheStatus: 'miss',
      },
      observation: 'Synthetic evidence',
    });
    async function produce(runId: string) {
      const session = runId === identity.parentRunId ? parentSession : await events.beginRunSession(identity.conversationId, runId, { kind: 'agent' });
      await events.appendEventToRun(
        session,
        routeRuntimeEvent(
          createToolOutputEvent(
            `event-${runId}`,
            identity.conversationId,
            'citation-turn',
            'web_search',
            `call-${runId}`,
            { status: 'success', data: evidence.data, observation: evidence.observation }
          ),
          { run_id: RunIdSchema.parse(runId), lane: 'foreground', visibility: 'conversation' }
        )
      );
    }
    await produce('helper-only-source');
    const current = await parentStage('investigation', []);
    const input = {
      sourceRunId: identity.parentRunId,
      content: '# Record\n\n100 became 110 [@Abc234].',
      resultCommit: { prepare() {}, commit() {} },
    };
    await expect(current.session.submit(input)).rejects.toMatchObject({
      code: 'RESEARCH_DOCUMENT_CITATION_INVALID',
    });
    expect(
      store()
        .listRun(identity)
        .filter(item => item.receipt.artifact)
    ).toHaveLength(0);
    await produce(identity.parentRunId);
    const own = await current.session.submit(input);
    expect(own).toHaveProperty('run_id', identity.parentRunId);
    expect((await docs().read({ projectId: identity.projectId, inode: own.inode })).text).toContain(
      '100 became 110'
    );
  });
  it('同父的三份稿逐份核对祖先版本；父身份不能让初稿变化漏检', async () => {
    const investigation = await parentArticle('investigation', []);
    const draft = await parentArticle('draft', [investigation.path]);
    const argument = await stage('argument_review', [investigation.path, draft.path]);
    const source = await stage('source_review', [investigation.path, draft.path]);
    const revision = await parentArticle('revision', [
      investigation.path,
      draft.path,
      argument,
      source,
    ]);
    const owner = new MarkdownDocumentService(database.getDb());
    owner.saveNewVersion(
      draft.inode.slice('workspace:'.length),
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
                content: [{ type: 'text', text: 'User changed draft.' }],
              },
            ],
          },
        ],
      })
    );
    await expect(useCase('parent').complete(identity, revision.path)).rejects.toMatchObject({
      paths: [draft.path],
    });
  });
});
