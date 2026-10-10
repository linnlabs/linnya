import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { SQLiteEventStore } from '../event-store';
import { createWorkspaceResearchDocumentPort } from '../../research-documents';
import type { ResearchDocumentBinding } from '../../../application/research/definitions/researchDocumentPort';
import type {
  PreparedResearchStage,
  PreparedResearchChildStage,
  ResearchExecutionIdentity,
} from '../../../application/research/definitions/researchStageReceipt';
import { SqliteResearchStageReceiptStore } from './index';

let directory: string;
let database: DatabaseService;
let eventStore: SQLiteEventStore;
let workspace: WorkspaceService;
let receipts: SqliteResearchStageReceiptStore;
let identity: ResearchExecutionIdentity;

function openDatabase() {
  database = new DatabaseService(join(directory, 'workspace.sqlite'));
  database.initialize();
  eventStore = new SQLiteEventStore(database.getDb());
  workspace = new WorkspaceService(database.getDb());
  receipts = new SqliteResearchStageReceiptStore(database.getDb());
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'research-receipts-'));
  openDatabase();
  const projectId = workspace.createProject('Research receipt fixture');
  await eventStore.ensureConversation('research-conversation', [], projectId, 'agent');
  await eventStore.beginRunSession('research-conversation', 'research-parent', { kind: 'agent' });
  await eventStore.beginRunSession('research-conversation', 'research-author', { kind: 'agent' });
  identity = {
    parentRunId: 'research-parent',
    toolCallId: 'research-call',
    projectId,
    conversationId: 'research-conversation',
    modelId: 'frozen-model',
  };
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function inputBinding(): ResearchDocumentBinding {
  return {
    inode: 'workspace:input-document',
    locator: 'workspace:/input.md',
    representation: 'workspace-markdown-current-v1',
    sha256: 'a'.repeat(64),
    citationSha256: 'b'.repeat(64),
  };
}

function prepared(): PreparedResearchChildStage {
  return {
    stage: 'investigation',
    invocation: ResearchRunArgsSchema.parse({
      question: 'Review the synthetic case',
      reader: 'General reader',
      task_type: 'fixed',
      materials: ['workspace:/input.md'],
    }),
    subrunId: 'research-author',
    request: {
      promptKey: 'deep_research_experimental',
      query: '  Frozen request\nRead workspace:/input.md.\n',
      methodVersion: 'research-feedback-v1',
      requiredResources: ['references/modeling.md', 'references/article-craft.md'],
    },
    inputs: [inputBinding()],
    outputPath: 'workspace:/investigation.md',
  };
}

function saveStage(input: PreparedResearchChildStage, afterCommit?: () => void) {
  const documents = createWorkspaceResearchDocumentPort({
    db: database.getDb(),
    workspaceService: workspace,
    eventStore,
  });
  return documents.save({
    projectId: identity.projectId,
    conversationId: identity.conversationId,
    sourceRunId: input.subrunId,
    path: input.outputPath,
    text: '# Investigation\n\nSynthetic findings.',
    receipt: {
      prepare: () => receipts.assertPrepared(identity, input),
      commit: artifact => {
        receipts.commitArtifact(identity, input, artifact);
        afterCommit?.();
      },
    },
  });
}

describe('Research stage receipt persistence', () => {
  it('重入与真正重新打开SQLite复用同一请求、child身份和产物，不重新派生prompt', async () => {
    const input = prepared();
    expect(receipts.prepare(identity, input)).toEqual(input);
    expect(receipts.prepare(identity, input)).toEqual(input);
    const output = await saveStage(input);
    database.close();
    openDatabase();
    const recovered = receipts.prepare(identity, input);
    if ('runId' in recovered) throw new Error('Expected child receipt');
    expect(recovered.request.query).toBe(input.request.query);
    expect(recovered.subrunId).toBe(input.subrunId);
    expect(recovered.artifact).toMatchObject({ inode: output.inode, sha256: output.sha256 });
    expect(receipts.list(identity)).toEqual([recovered]);
    expect(workspace.getChildNodes(null, identity.projectId)).toHaveLength(1);
  });

  it('拒绝变更身份、模型、输入版本、请求、方法或输出路径，不修改冻结回执', () => {
    const input = prepared();
    receipts.prepare(identity, input);
    for (const changedIdentity of [
      { ...identity, projectId: 'another-project' },
      { ...identity, conversationId: 'another-conversation' },
      { ...identity, modelId: 'another-model' },
    ]) {
      expect(() => receipts.prepare(changedIdentity, input)).toThrow('identity differs');
      expect(() => receipts.list(changedIdentity)).toThrow('identity differs');
    }
    const changedInputs: PreparedResearchStage[] = [
      { ...input, subrunId: 'replacement-child' },
      { ...input, request: { ...input.request, query: 'Rebuilt prompt' } },
      {
        ...input,
        request: { ...input.request, requiredResources: ['references/business-analysis.md'] },
      },
      { ...input, inputs: [{ ...inputBinding(), sha256: 'c'.repeat(64) }] },
      { ...input, outputPath: 'workspace:/replacement.md' },
      { ...input, invocation: { ...input.invocation, reader: 'Different reader' } },
    ];
    for (const changed of changedInputs) {
      expect(() => receipts.prepare(identity, changed)).toThrow('differs from its frozen');
      expect(() => receipts.assertPrepared(identity, changed)).toThrow('differs from its frozen');
    }
    expect(receipts.list(identity)).toEqual([input]);
  });

  it('正文和receipt同事务回滚；恢复后只创建一个新稿并拒绝替换既有产物绑定', async () => {
    const input = prepared();
    receipts.prepare(identity, input);
    await expect(
      saveStage(input, () => {
        throw new Error('simulated receipt transaction failure');
      })
    ).rejects.toThrow('simulated receipt transaction failure');
    expect(workspace.getChildNodes(null, identity.projectId)).toEqual([]);
    expect(receipts.list(identity)).toEqual([input]);
    const output = await saveStage(input);
    const recovered = receipts.list(identity)[0];
    if (!recovered?.artifact) throw new Error('Expected committed artifact');
    const artifact = recovered.artifact;
    expect(artifact.inode).toBe(output.inode);
    expect(() => receipts.commitArtifact(identity, input, artifact)).toThrow(
      'requires the document creation transaction'
    );
    database
      .getDb()
      .transaction(() => receipts.commitArtifact(identity, input, artifact))
      .immediate();
    expect(() =>
      database
        .getDb()
        .transaction(() =>
          receipts.commitArtifact(identity, input, {
            ...artifact,
            sha256: 'c'.repeat(64),
          })
        )
        .immediate()
    ).toThrow('different artifact binding');
    expect(receipts.list(identity)).toEqual([recovered]);
    expect(workspace.getChildNodes(null, identity.projectId)).toHaveLength(1);
  });

  it('没有prepared阶段或错误目标路径不能取得产物绑定', () => {
    const input = prepared();
    expect(() => receipts.assertPrepared(identity, input)).toThrow('no prepared receipt');
    const artifact = { ...inputBinding(), locator: input.outputPath };
    expect(() =>
      database
        .getDb()
        .transaction(() => receipts.commitArtifact(identity, input, artifact))
        .immediate()
    ).toThrow('no prepared receipt');
    receipts.prepare(identity, input);
    expect(() =>
      database
        .getDb()
        .transaction(() => receipts.commitArtifact(identity, input, inputBinding()))
        .immediate()
    ).toThrow('path differs');
    expect(receipts.list(identity)).toEqual([input]);
  });

  it('父run删除级联清理阶段回执，不删除独立Workspace交付文档', async () => {
    const input = prepared();
    receipts.prepare(identity, input);
    await saveStage(input);
    // 直接删除父run用于验收此adapter拥有的FK；运行生命周期本身仍由RunSupervisor负责。
    database.getDb().prepare('DELETE FROM runs WHERE id = ?').run(identity.parentRunId);
    expect(receipts.list(identity)).toEqual([]);
    expect(workspace.getChildNodes(null, identity.projectId)).toHaveLength(1);
  });
});
