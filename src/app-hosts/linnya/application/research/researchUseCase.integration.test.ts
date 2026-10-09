import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { SQLiteEventStore } from '../../adapters/persistence/event-store';
import { createWorkspaceResearchDocumentPort } from '../../adapters/research-documents';
import { SqliteResearchStageReceiptStore } from '../../adapters/persistence/research-stage-receipts';
import { createResearchUseCase } from './index';
import type { ResearchChildPort } from './definitions/researchUseCase';
import type {
  PreparedResearchStage,
  ResearchExecutionIdentity,
} from './definitions/researchStageReceipt';
import type { ResearchRunArgs } from '@app/schemas';

let database: DatabaseService;
let workspace: WorkspaceService;
let events: SQLiteEventStore;
let identity: ResearchExecutionIdentity;
const input: ResearchRunArgs = {
  question: 'Explain the change without inventing causes.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
};
const calls: PreparedResearchStage[] = [];

function documents() {
  return createWorkspaceResearchDocumentPort({ db: database.getDb(), eventStore: events });
}
function receipts() {
  return new SqliteResearchStageReceiptStore(database.getDb());
}
async function output(stage: PreparedResearchStage) {
  calls.push(stage);
  const id = `child-${stage.stage}`;
  await events.beginRunSession(identity.conversationId, id, { kind: 'agent' });
  return {
    sourceRunId: id,
    text: `# ${stage.stage}\n\nA bounded research artifact, with limitations.`,
  };
}
function useCase(execute: ResearchChildPort['execute'] = output) {
  return createResearchUseCase({
    documents: documents(),
    receipts: receipts(),
    children: { execute },
  });
}
async function edit(locator: string) {
  const current = await documents().read({ projectId: identity.projectId, locator });
  const id = current.inode.slice('workspace:'.length);
  const owner = new MarkdownDocumentService(database.getDb());
  const block = owner.getDocument(id).content?.[0];
  const blockId = block?.attrs?.id;
  if (typeof blockId !== 'string') throw new Error('Missing fixture block');
  owner.setPendingRevision(id, blockId, 'User supplied a materially different input.', 'user');
}

beforeEach(async () => {
  calls.length = 0;
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  events = new SQLiteEventStore(database.getDb());
  const projectId = workspace.createProject('Research acceptance');
  await events.ensureConversation('research-conversation', [], projectId, 'agent');
  await events.beginRunSession('research-conversation', 'parent-research-run', { kind: 'agent' });
  identity = {
    projectId,
    conversationId: 'research-conversation',
    parentRunId: 'parent-research-run',
    toolCallId: 'research-call',
    modelId: 'fixture-model',
  };
  await documents().save({
    projectId,
    conversationId: identity.conversationId,
    sourceRunId: identity.parentRunId,
    path: 'workspace:/source.md',
    text: '# Source\n\nBaseline is 100; current is 110.',
    receipt: { prepare() {}, commit() {} },
  });
});
afterEach(() => database.close());

describe('Research stage acceptance with real Workspace and receipt transactions', () => {
  it('保存六份独立稿件、两评审不互相泄漏；恢复不调用已完成阶段或重复创建', async () => {
    const result = await useCase().execute(input, identity);
    expect(result.status).toBe('delivered');
    expect(calls.map(item => item.stage)).toEqual([
      'investigation',
      'investigation_review',
      'draft',
      'argument_review',
      'source_review',
      'revision',
    ]);
    for (const item of calls.filter(
      item => item.stage.endsWith('_review') && item.stage !== 'investigation_review'
    )) {
      expect(item.inputs).toHaveLength(4);
      expect(
        item.inputs.some(
          binding =>
            binding.locator.includes('argument_review') || binding.locator.includes('source_review')
        )
      ).toBe(false);
    }
    const firstResult = JSON.stringify(result);
    const reloaded = await useCase().execute(input, identity);
    expect(JSON.stringify(reloaded)).toBe(firstResult);
    expect(calls).toHaveLength(6);
    expect(workspace.getChildNodes(null, identity.projectId)).toHaveLength(7);
    for (const artifact of reloaded.artifacts) {
      const current = await documents().read({
        projectId: identity.projectId,
        inode: artifact.inode,
      });
      expect(current.sha256).toBe(artifact.sha256);
    }
  });

  it('调查时用户改材料仍保留旧绑定候选，但不接纳调查复核；恢复不能刷新旧输入', async () => {
    const result = await useCase(async stage => {
      const answer = await output(stage);
      await edit('workspace:/source.md');
      return answer;
    }).execute(input, identity);
    expect(result).toMatchObject({
      status: 'inputs_changed',
      changed_paths: ['workspace:/source.md'],
    });
    expect(result.artifacts).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect((await useCase().execute(input, identity)).status).toBe('inputs_changed');
    expect(calls).toHaveLength(1);
    expect(
      (await documents().read({ projectId: identity.projectId, locator: 'workspace:/source.md' }))
        .text
    ).toContain('User supplied');
  });

  it('并行一方中断先保留另一份评审，恢复只接未完成身份，不重发已接纳同伴', async () => {
    let interrupted = false;
    const interruptedUseCase = useCase(async stage => {
      if (stage.stage === 'argument_review' && !interrupted) {
        interrupted = true;
        throw new Error('simulated resumable transport interruption');
      }
      return output(stage);
    });
    await expect(interruptedUseCase.execute(input, identity)).rejects.toThrow(
      'transport interruption'
    );
    expect(
      receipts()
        .list(identity)
        .find(item => item.stage === 'source_review')?.artifact
    ).toBeDefined();
    expect(calls.some(item => item.stage === 'revision')).toBe(false);
    expect((await interruptedUseCase.execute(input, identity)).status).toBe('delivered');
    expect(calls.filter(item => item.stage === 'source_review')).toHaveLength(1);
    expect(calls.filter(item => item.stage === 'revision')).toHaveLength(1);
  });

  it('已绑定材料超出完整读取范围属于输入失效；首次截断材料仍不能接纳', async () => {
    const current = await documents().read({
      projectId: identity.projectId,
      locator: 'workspace:/source.md',
    });
    const enlargeSource = () =>
      new MarkdownDocumentService(database.getDb()).saveNewVersion(
        current.inode.slice('workspace:'.length),
        JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'rootBlock',
              attrs: { id: 'large-root' },
              content: [
                {
                  type: 'baseBlock',
                  attrs: { id: 'large-base' },
                  content: [{ type: 'text', text: 'x'.repeat(20 * 1024 * 1024 + 1) }],
                },
              ],
            },
          ],
        })
      );
    const result = await useCase(async stage => {
      const answer = await output(stage);
      enlargeSource();
      return answer;
    }).execute(input, identity);
    expect(result).toMatchObject({
      status: 'inputs_changed',
      changed_paths: ['workspace:/source.md'],
    });
    expect(result.artifacts).toHaveLength(1);
    expect((await useCase().execute(input, identity)).status).toBe('inputs_changed');
    await expect(
      useCase().execute(input, { ...identity, toolCallId: 'new-admission' })
    ).rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_TRUNCATED' });
  });

  it('已保存初稿被用户改动使旧评审失效，恢复不覆盖或重新生成初稿', async () => {
    await useCase().execute(input, identity);
    const draft = receipts()
      .list(identity)
      .find(item => item.stage === 'draft')?.artifact;
    if (!draft) throw new Error('Draft missing');
    await edit(draft.locator);
    expect(await useCase().execute(input, identity)).toMatchObject({
      status: 'inputs_changed',
      changed_paths: [draft.locator],
    });
    expect(calls).toHaveLength(6);
    expect(
      (await documents().read({ projectId: identity.projectId, inode: draft.inode })).text
    ).toContain('User supplied');
  });

  it('空稿与取消均停止后继，同调用改问题也不能借旧回执成功', async () => {
    await expect(
      useCase(async stage => ({ ...(await output(stage)), text: ' ' })).execute(input, identity)
    ).rejects.toThrow('no document');
    expect(receipts().list(identity)).toHaveLength(1);
    expect(receipts().list(identity)[0]?.artifact).toBeUndefined();
    await expect(
      useCase().execute({ ...input, question: 'A different task' }, identity)
    ).rejects.toThrow('invocation changed');
    const controller = new AbortController();
    controller.abort();
    await expect(useCase().execute(input, identity, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toHaveLength(1);
  });
});
