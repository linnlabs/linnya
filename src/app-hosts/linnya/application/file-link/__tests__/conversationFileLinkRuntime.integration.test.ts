import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationFileLinkResolveRequestSchema,
  ConversationFileLinkRevealRequestSchema,
  formatHostFileLocator,
} from '@app/schemas';
import type { ConversationWorkDirectoryAdmissionPort } from '../../conversation-lifecycle';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { createConversationFileLinkRuntime } from '../orchestration/createConversationFileLinkRuntime';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT
    );
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_opened_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT
    );
  `);
}

describe('createConversationFileLinkRuntime', () => {
  let root = '';
  let db: Database.Database;
  let conversationRoots: ReadonlyMap<string, string>;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-file-link-'));
    const conversationA = path.join(root, 'conversation-a');
    const conversationB = path.join(root, 'conversation-b');
    await fsp.mkdir(conversationA);
    await fsp.mkdir(conversationB);
    conversationRoots = new Map([
      ['conversation-a', conversationA],
      ['conversation-b', conversationB],
    ]);
    db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO conversations (conversation_id, project_id) VALUES (?, ?)')
      .run('conversation-a', 'project-a');
    db.prepare('INSERT INTO conversations (conversation_id, project_id) VALUES (?, ?)')
      .run('conversation-b', 'project-b');
    const insertNode = db.prepare(`
      INSERT INTO workspace_nodes (
        id, project_id, parent_id, type, name, icon, created_at, updated_at,
        deleted_at, last_opened_at, access_count, tags
      ) VALUES (?, ?, NULL, 'presentation', ?, NULL, 1, 1, NULL, NULL, 0, NULL)
    `);
    insertNode.run('slides-a', 'project-a', '同名试稿.slides');
    insertNode.run('slides-b', 'project-b', '同名试稿.slides');
  });

  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  function createRuntime() {
    const admission: ConversationWorkDirectoryAdmissionPort = {
      async withAdmission(input, admitted) {
        const conversationId = typeof input.conversationId === 'string'
          ? input.conversationId
          : '';
        const absolutePath = conversationRoots.get(conversationId);
        if (!absolutePath) throw new Error('conversation 不存在');
        return admitted({
          identity: deriveConversationWorkDirectoryIdentity(conversationId),
          absolutePath,
          status: 'existing',
        });
      },
    };
    return createConversationFileLinkRuntime({
      db,
      conversationWorkDirectoryAdmission: admission,
    });
  }

  function requireConversationRoot(conversationId: string): string {
    const absolutePath = conversationRoots.get(conversationId);
    if (!absolutePath) {
      throw new Error(`测试缺少 conversation 工作目录：${conversationId}`);
    }
    return absolutePath;
  }

  it('Workspace path 始终按回答所属 conversation 的 project 解析', async () => {
    await expect(createRuntime().resolve(ConversationFileLinkResolveRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: 'workspace:/同名试稿.slides',
    }))).resolves.toMatchObject({
      state: 'ready',
      kind: 'workspace',
      project_id: 'project-a',
      document_id: 'slides-a',
    });
  });

  it('Conversation locator 只解析所属工作目录中的普通文件', async () => {
    await fsp.writeFile(path.join(requireConversationRoot('conversation-a'), '预览.png'), 'bytes');
    await fsp.writeFile(path.join(requireConversationRoot('conversation-b'), '预览.png'), 'other');

    await expect(createRuntime().resolve(ConversationFileLinkResolveRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: 'conversation:/预览.png',
    }))).resolves.toEqual({
      state: 'ready',
      kind: 'conversation',
      locator: 'conversation:/预览.png',
      file_name: '预览.png',
    });
  });

  it('Conversation symlink 不可通过链接解析或 reveal', async () => {
    const hostFile = path.join(root, 'outside.txt');
    const linkPath = path.join(requireConversationRoot('conversation-a'), 'outside.txt');
    await fsp.writeFile(hostFile, 'secret');
    await fsp.symlink(hostFile, linkPath);
    const runtime = createRuntime();

    await expect(runtime.resolve(ConversationFileLinkResolveRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: 'conversation:/outside.txt',
    }))).resolves.toMatchObject({
      state: 'unavailable',
      issue_code: 'target_not_regular_file',
    });
    await expect(runtime.reveal(ConversationFileLinkRevealRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: 'conversation:/outside.txt',
    }), () => undefined)).rejects.toThrow('conversation 文件不能是符号链接');
  });

  it('Host file 只把准入后的真实路径交给 reveal adapter', async () => {
    const hostFile = path.join(root, '外部报告.pdf');
    await fsp.writeFile(hostFile, 'pdf');
    const revealed: string[] = [];
    const runtime = createRuntime();

    await runtime.reveal(ConversationFileLinkRevealRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: formatHostFileLocator(hostFile),
    }), absolutePath => {
      revealed.push(absolutePath);
    });

    expect(revealed).toEqual([await fsp.realpath(hostFile)]);
  });
});
