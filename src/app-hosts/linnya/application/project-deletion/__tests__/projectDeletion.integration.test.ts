import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectLifecycle } from 'src/domains/projects';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { CONVERSATION_SCHEMAS } from '../../../adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from '../../../adapters/persistence/event-store';
import { CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA } from '../../../adapters/persistence/conversation-files';
import {
  COMMAND_APPROVAL_SCHEMAS,
  SqliteConversationCommandApprovalPort,
} from '../../../adapters/persistence/command-approvals';
import { COMMAND_CARD_SETTLEMENT_SCHEMAS } from '../../../adapters/persistence/command-card-settlements/commandCardSettlements.schema';
import { SqliteCommandCardSettlementPort } from '../../../adapters/persistence/command-card-settlements/sqliteCommandCardSettlementPort';
import {
  createSqliteProjectDeletionCatalog,
  PROJECT_DELETION_SCHEMA,
} from '../../../adapters/persistence/project-deletion';
import { createConversationRouteLifecycle } from 'src/electron-main/routes/orchestration/createConversationRouteLifecycle';
import { createLocalConversationDirectoryPort } from 'src/infra/adapters/conversation-files/local-directory';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { deriveCommandOutputConversationDirectory } from 'src/infra/adapters/command-runtime/output';
import { createProjectDeletionUseCase } from '../index';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-project-deletion-'));
  const db = new Database(':memory:');
  disposals.push(async () => {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  db.pragma('foreign_keys = ON');
  for (const schema of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...CONVERSATION_SCHEMAS,
    ...CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
    ...COMMAND_APPROVAL_SCHEMAS,
    ...COMMAND_CARD_SETTLEMENT_SCHEMAS,
    ...PROJECT_DELETION_SCHEMA,
  ])
    db.exec(schema);
  const projects = createProjectLifecycle(db);
  const projectId = projects.create({ name: 'Delete target' });
  const otherProjectId = projects.create({ name: 'Keep' });
  const events = new SQLiteEventStore(db);
  const artifactsRoot = path.join(root, 'artifacts');
  const lifecycle = createConversationRouteLifecycle({
    db,
    eventStore: events,
    storageRoot: root,
    artifactsRoot,
  });
  const directories = createLocalConversationDirectoryPort({ storageRoot: root });
  const stop = vi.fn<(id: string) => Promise<void>>(async () => {});
  const cards = new SqliteCommandCardSettlementPort(db);
  const cleanup = lifecycle.bindCleanup({
    commands: {
      beginConversationStop() {},
      async stopConversationAndWait() {},
      forgetDeletedConversation() {},
    },
    approvals: new SqliteConversationCommandApprovalPort(db),
    commandCardSettlements: {
      async drainConversation() {},
      deleteForConversation: id => cards.deleteForConversation(id),
    },
    stopFlowAndWait: stop,
  });
  const deletion = createProjectDeletionUseCase({
    catalog: createSqliteProjectDeletionCatalog(db, projects),
    conversations: cleanup,
  });
  async function seed(id: string, owner?: string) {
    await events.ensureConversation(
      id,
      [
        {
          id: `message-${id}`,
          type: 'user_input',
          timestamp: Date.now(),
          conversation_id: id,
          turn_id: `turn-${id}`,
          version: 1,
          content: `Content ${id}`,
          source: 'user',
        },
      ],
      owner
    );
    const directory = await directories.ensureDirectory(
      deriveConversationWorkDirectoryIdentity(id)
    );
    const roots = [
      directory.absolutePath,
      path.join(artifactsRoot, id),
      path.join(artifactsRoot, deriveCommandOutputConversationDirectory(id)),
    ];
    for (const folder of roots) {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'owned-content'), id);
    }
    return roots;
  }
  return { db, root, projectId, otherProjectId, projects, events, stop, deletion, cleanup, seed };
}

describe('Project deletion through the shared conversation lifecycle', () => {
  it('删除项目内所有会话、投影、工作文件和工具文件，保留其他项目与无项目会话及共享资源', async () => {
    const f = await fixture();
    const removedPaths = [
      ...(await f.seed('project-chat-a', f.projectId)),
      ...(await f.seed('project-chat-b', f.projectId)),
    ];
    const retainedPaths = [
      ...(await f.seed('other-chat', f.otherProjectId)),
      ...(await f.seed('unscoped-chat')),
    ];
    f.db
      .prepare(
        "INSERT INTO assets (id, uri, storage_status, created_at) VALUES ('shared', '/Resources/Attachments/shared', 'local', 1)"
      )
      .run();
    const link = f.db.prepare(
      "INSERT INTO project_asset_links (project_id, asset_id, created_at) VALUES (?, 'shared', 1)"
    );
    link.run(f.projectId);
    link.run(f.otherProjectId);
    f.db
      .prepare(
        "INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at) VALUES ('doc', ?, 'document', 'Owned document', 1, 1)"
      )
      .run(f.projectId);
    f.db
      .prepare(
        "INSERT INTO document_asset_links (document_node_id, asset_id) VALUES ('doc', 'shared')"
      )
      .run();
    await f.deletion.requestDeletion(f.projectId);

    expect(f.projects.list().map(project => project.id)).toEqual([f.otherProjectId]);
    expect(
      f.db.prepare('SELECT conversation_id FROM conversations ORDER BY conversation_id').all()
    ).toEqual([{ conversation_id: 'other-chat' }, { conversation_id: 'unscoped-chat' }]);
    for (const table of [
      'runs',
      'conversation_ui_messages',
      'conversation_ui_projection_state',
      'conversation_command_card_settlements',
    ]) {
      expect(
        f.db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${table} WHERE conversation_id IN ('project-chat-a', 'project-chat-b')`
          )
          .get()
      ).toEqual({ count: 0 });
    }
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) AS count FROM events WHERE id IN ('message-project-chat-a', 'message-project-chat-b')"
        )
        .get()
    ).toEqual({ count: 0 });
    expect(
      f.db.prepare("SELECT project_id FROM project_asset_links WHERE asset_id = 'shared'").all()
    ).toEqual([{ project_id: f.otherProjectId }]);
    expect(f.db.prepare("SELECT id FROM assets WHERE id = 'shared'").get()).toEqual({
      id: 'shared',
    });
    expect(f.db.prepare("SELECT 1 FROM workspace_nodes WHERE id = 'doc'").get()).toBeUndefined();
    expect(
      f.db.prepare("SELECT 1 FROM document_asset_links WHERE document_node_id = 'doc'").get()
    ).toBeUndefined();
    expect(f.stop.mock.calls.map(([id]) => id)).toEqual(['project-chat-a', 'project-chat-b']);
    for (const removed of removedPaths)
      await expect(fs.stat(removed)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const retained of retainedPaths)
      await expect(fs.readFile(path.join(retained, 'owned-content'), 'utf8')).resolves.toMatch(
        /other-chat|unscoped-chat/
      );
  });

  it('部分会话停止失败时不删除父项目或解除剩余会话归属，重试复用持久清理任务', async () => {
    const f = await fixture();
    await f.seed('project-chat-a', f.projectId);
    await f.seed('project-chat-b', f.projectId);
    f.stop
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('process still alive'));
    await expect(f.deletion.requestDeletion(f.projectId)).rejects.toMatchObject({
      name: 'ProjectDeletionIncompleteError',
    });
    expect(f.projects.get(f.projectId).id).toBe(f.projectId);
    expect(await f.events.getConversationMetadata('project-chat-a')).toBeNull();
    expect(await f.events.getConversationMetadata('project-chat-b')).toMatchObject({
      project_id: f.projectId,
    });
    await f.deletion.requestDeletion(f.projectId);
    expect(f.projects.list().map(project => project.id)).toEqual([f.otherProjectId]);
    expect(await f.events.getConversationMetadata('project-chat-b')).toBeNull();
  });

  it('清理期间新增的会话会阻止最终删除，不能通过外键被移入无项目历史', async () => {
    const f = await fixture();
    await f.seed('project-chat-a', f.projectId);
    f.stop.mockImplementationOnce(async () => {
      await f.seed('new-chat', f.projectId);
    });
    await expect(f.deletion.requestDeletion(f.projectId)).rejects.toMatchObject({
      name: 'ProjectDeletionIncompleteError',
    });
    expect(await f.events.getConversationMetadata('new-chat')).toMatchObject({
      project_id: f.projectId,
    });
    expect(f.projects.get(f.projectId).id).toBe(f.projectId);
    await f.deletion.requestDeletion(f.projectId);
    expect(await f.events.getConversationMetadata('new-chat')).toBeNull();
  });

  it('会话事实已删除但最后收尾失败时，持久项目清单让重试继续原清理任务', async () => {
    const f = await fixture();
    await f.seed('project-chat-a', f.projectId);
    f.db.exec(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON conversation_directory_cleanup_jobs
      BEGIN SELECT RAISE(FAIL, 'injected cleanup completion failure'); END`);
    await expect(f.deletion.requestDeletion(f.projectId)).rejects.toMatchObject({
      name: 'ProjectDeletionIncompleteError',
    });
    expect(await f.events.getConversationMetadata('project-chat-a')).toBeNull();
    expect(f.projects.get(f.projectId).id).toBe(f.projectId);
    expect(
      f.db.prepare('SELECT conversation_id FROM project_deletion_conversations').all()
    ).toEqual([{ conversation_id: 'project-chat-a' }]);
    f.db.exec('DROP TRIGGER fail_cleanup');
    // 重新装配项目用例模拟进程内状态丢失；清理身份只从数据库恢复。
    const retried = createProjectDeletionUseCase({
      catalog: createSqliteProjectDeletionCatalog(f.db, f.projects),
      conversations: f.cleanup,
    });
    await retried.requestDeletion(f.projectId);
    expect(
      f.db.prepare('SELECT COUNT(*) AS count FROM conversation_directory_cleanup_jobs').get()
    ).toEqual({ count: 0 });
    expect(
      f.db.prepare('SELECT COUNT(*) AS count FROM project_deletion_conversations').get()
    ).toEqual({ count: 0 });
    expect(f.projects.list().map(project => project.id)).toEqual([f.otherProjectId]);
  });
});
