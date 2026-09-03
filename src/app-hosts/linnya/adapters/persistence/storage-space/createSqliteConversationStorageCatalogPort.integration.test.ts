import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { CONVERSATION_SCHEMAS } from '../event-store/conversation.schema';
import { CORE_SCHEMAS } from '../../../../../features/workspace/infrastructure/sqlite/schemas/core.schema';
import { createSqliteConversationStorageCatalogPort } from './createSqliteConversationStorageCatalogPort';

const databases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  for (const ddl of CORE_SCHEMAS) db.exec(ddl);
  for (const ddl of CONVERSATION_SCHEMAS) db.exec(ddl);
  return db;
}

function insertProject(db: Database.Database, projectId: string): void {
  db.prepare<[string, string, number, number]>(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(projectId, `name-${projectId}`, 1, 1);
}

function insertConversation(db: Database.Database, input: {
  readonly conversationId: string;
  readonly title: string;
  readonly lastEventAt: number;
  readonly projectId: string | null;
}): void {
  db.prepare<[string, string, number, number, string | null]>(`
    INSERT INTO conversations (
      conversation_id,
      title,
      created_at,
      last_event_at,
      project_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    input.conversationId,
    input.title,
    input.lastEventAt - 1,
    input.lastEventAt,
    input.projectId,
  );
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('SQLite conversation storage catalog adapter', () => {
  it('全量读取无项目和不同项目对话，并按最近时间与 identity 稳定排序', () => {
    const db = createDatabase();
    insertProject(db, 'project-a');
    insertProject(db, 'project-z');
    insertConversation(db, {
      conversationId: 'conversation-assistant',
      title: '助手对话',
      lastEventAt: 100,
      projectId: null,
    });
    insertConversation(db, {
      conversationId: 'conversation-project-a',
      title: '项目甲',
      lastEventAt: 200,
      projectId: 'project-a',
    });
    insertConversation(db, {
      conversationId: 'conversation-project-z',
      title: '项目乙',
      lastEventAt: 200,
      projectId: 'project-z',
    });

    const catalog = createSqliteConversationStorageCatalogPort(db);

    expect(catalog.listAll()).toEqual([
      {
        conversationId: 'conversation-project-z',
        title: '项目乙',
        lastEventAt: 200,
        projectId: 'project-z',
      },
      {
        conversationId: 'conversation-project-a',
        title: '项目甲',
        lastEventAt: 200,
        projectId: 'project-a',
      },
      {
        conversationId: 'conversation-assistant',
        title: '助手对话',
        lastEventAt: 100,
        projectId: null,
      },
    ]);
    expect(catalog.listAll()).toEqual(catalog.listAll());
  });

  it('原样保留 Unicode 和空标题，空库返回空目录', () => {
    const emptyCatalog = createSqliteConversationStorageCatalogPort(createDatabase());
    expect(emptyCatalog.listAll()).toEqual([]);

    const db = createDatabase();
    insertProject(db, 'project-empty-title');
    insertConversation(db, {
      conversationId: 'conversation-unicode',
      title: '中文 📁 café',
      lastEventAt: 10,
      projectId: null,
    });
    insertConversation(db, {
      conversationId: 'conversation-empty-title',
      title: '',
      lastEventAt: 9,
      projectId: 'project-empty-title',
    });

    expect(createSqliteConversationStorageCatalogPort(db).listAll()).toEqual([
      {
        conversationId: 'conversation-unicode',
        title: '中文 📁 café',
        lastEventAt: 10,
        projectId: null,
      },
      {
        conversationId: 'conversation-empty-title',
        title: '',
        lastEventAt: 9,
        projectId: 'project-empty-title',
      },
    ]);
  });
});
