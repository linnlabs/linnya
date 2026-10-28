import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectMutationEvent } from '@app/schemas';
import {
  createProjectLifecycle,
  ProjectNotEmptyError,
  ProjectNotFoundError,
  DefaultProjectDeleteBlockedError,
  ProjectDeleteBlockedError,
} from 'src/domains/projects';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { TODO_SCHEMAS } from 'src/features/project-todo/infrastructure/sqlite/todo.schema';
import { KNOWLEDGE_BASE_SCHEMAS } from 'src/features/knowledge-base/infrastructure/sqlite/knowledge-base.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { CONVERSATION_SCHEMAS } from '../../persistence/event-store/conversation.schema';

describe('Empty project deletion preserves every linked owner', () => {
  let db: Database.Database;
  let events: ProjectMutationEvent[];
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    [
      ...CORE_SCHEMAS,
      ...TODO_SCHEMAS,
      ...KNOWLEDGE_BASE_SCHEMAS,
      ...ASSET_LEDGER_SCHEMAS,
      ...CONVERSATION_SCHEMAS,
    ].forEach(sql => db.exec(sql));
    events = [];
  });
  afterEach(() => db.close());
  const linkedCases = [
    [
      '文件夹',
      "INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at) VALUES ('node', ?, 'folder', 'Folder', 1, 1)",
    ],
    [
      '软删除文档',
      "INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at, deleted_at) VALUES ('node', ?, 'document', 'History', 1, 1, 2)",
    ],
    [
      '会话',
      "INSERT INTO conversations (conversation_id, project_id, created_at, last_event_at) VALUES ('conversation', ?, 1, 1)",
    ],
    [
      '已完成待办',
      "INSERT INTO todos (id, project_id, title, status, created_at, updated_at) VALUES ('todo', ?, 'Task', 'completed', 1, 1)",
    ],
  ];
  it.each(linkedCases)('%s 阻止删除，拒绝后原记录和项目关联完整保留', (_name, sql) => {
    const projects = createProjectLifecycle(db, { publish: event => events.push(event) });
    const id = projects.create({ name: 'Used' });
    db.prepare(sql).run(id);
    const before = db.serialize();
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectNotEmptyError);
    expect(db.serialize()).toEqual(before);
    expect(events.map(event => event.type)).toEqual(['project.created']);
  });

  it('知识库、历史资产关系和未加载插件记录都阻止删除，不依赖运行时注册', () => {
    const projects = createProjectLifecycle(db, { publish: event => events.push(event) });
    const id = projects.create({ name: 'Linked' });
    db.exec(
      "INSERT INTO knowledge_bases (id, name, created_at, updated_at) VALUES ('kb', 'KB', 1, 1)"
    );
    db.prepare("INSERT INTO project_knowledge_base_links VALUES (?, 'kb', 'read_write', 1, 1)").run(
      id
    );
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectNotEmptyError);
    expect(db.prepare('SELECT project_id FROM project_knowledge_base_links').get()).toEqual({
      project_id: id,
    });
    db.prepare('DELETE FROM project_knowledge_base_links WHERE project_id = ?').run(id);
    db.exec(
      "INSERT INTO assets (id, uri, storage_status, created_at) VALUES ('asset', 'asset://test', 'local', 1)"
    );
    db.prepare(
      "INSERT INTO project_asset_links (project_id, asset_id, created_at) VALUES (?, 'asset', 1)"
    ).run(id);
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectNotEmptyError);
    expect(db.prepare('SELECT project_id FROM project_asset_links').get()).toEqual({
      project_id: id,
    });
    db.prepare('DELETE FROM project_asset_links WHERE project_id = ?').run(id);
    // 复现插件独立项目表；没有节点、没有加载插件模块，也必须保留其持久记录。
    db.exec(
      'CREATE TABLE plugin_records (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, content TEXT)'
    );
    db.prepare("INSERT INTO plugin_records VALUES (?, 'keep')").run(id);
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectNotEmptyError);
    expect(db.prepare('SELECT * FROM plugin_records').get()).toEqual({
      project_id: id,
      content: 'keep',
    });
    expect(events.map(event => event.type)).toEqual(['project.created']);
  });

  it('无关联普通项目删除一次并提交后通知；默认项目、不存在和限制型关联明确拒绝', () => {
    const projects = createProjectLifecycle(db, {
      publish: event => {
        expect(db.inTransaction).toBe(false);
        events.push(event);
      },
    });
    const id = projects.create({ name: 'Empty' });
    const other = projects.create({ name: 'Other' });
    const defaultId = projects.ensureDefault();
    expect(() => projects.deleteEmpty(defaultId)).toThrow(DefaultProjectDeleteBlockedError);
    db.exec(
      'CREATE TABLE plugin_references (project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT)'
    );
    db.prepare('INSERT INTO plugin_references VALUES (?)').run(id);
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectDeleteBlockedError);
    db.prepare('DELETE FROM plugin_references WHERE project_id = ?').run(id);
    projects.deleteEmpty(id);
    expect(() => projects.deleteEmpty(id)).toThrow(ProjectNotFoundError);
    expect(projects.get(other).name).toBe('Other');
    expect(events.filter(event => event.type === 'project.deleted')).toEqual([
      { type: 'project.deleted', projectId: id, mutationId: expect.any(String) },
    ]);
  });
});
