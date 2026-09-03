import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CommandConversationApprovalCandidateSchema,
  CommandApprovalRequestIdSchema,
  CommandConversationIdSchema,
  type CommandApprovalRequestId,
  type CommandConversationApprovalCandidate,
  type CommandConversationId,
} from '@app/schemas/commands';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type ConversationCommandApproval,
} from '../../../../../../domains/commands';
import { COMMAND_APPROVAL_SCHEMAS } from '../commandApprovals.schema';
import { SqliteConversationCommandApprovalPort } from '../sqliteConversationCommandApprovalPort';

const testRoots: string[] = [];
const testDatabases: Database.Database[] = [];

async function createDatabasePath(label: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-command-approval-${label}-`));
  testRoots.push(root);
  return path.join(root, 'workspace.sqlite');
}

function openDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  testDatabases.push(db);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS conversations (conversation_id TEXT PRIMARY KEY)');
  for (const ddl of COMMAND_APPROVAL_SCHEMAS) {
    db.exec(ddl);
  }
  return db;
}

function conversationId(value: string): CommandConversationId {
  return CommandConversationIdSchema.parse(value);
}

function approvalRequestId(sequence: number): CommandApprovalRequestId {
  return CommandApprovalRequestIdSchema.parse(
    `command_approval_00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
  );
}

function candidate(input: {
  readonly tokenPrefix?: readonly string[];
  readonly platform?: 'macos' | 'windows';
  readonly shellSemanticsId?: string;
  readonly matcherRevision?: string;
} = {}): CommandConversationApprovalCandidate {
  return CommandConversationApprovalCandidateSchema.parse({
    token_prefix: input.tokenPrefix ?? ['git', 'status'],
    matching_context: {
      platform: input.platform ?? 'macos',
      shell_semantics_id: input.shellSemanticsId ?? 'zsh',
      matcher_revision: input.matcherRevision ?? 'simple-command-v1',
    },
  });
}

function approval(input: {
  readonly approvalRequestId?: CommandApprovalRequestId;
  readonly conversationId: CommandConversationId;
  readonly candidate?: CommandConversationApprovalCandidate;
  readonly approvedCwd?: string;
  readonly approvedAtMs?: number;
}): ConversationCommandApproval {
  return {
    approvalRequestId: input.approvalRequestId ?? approvalRequestId(1),
    conversationId: input.conversationId,
    candidate: input.candidate ?? candidate(),
    approvedCwd: input.approvedCwd ?? '/tmp/linnya-command-approval',
    approvedAtMs: input.approvedAtMs ?? 1_785_499_200_000,
  };
}

function seedConversation(db: Database.Database, id: CommandConversationId): void {
  db.prepare('INSERT INTO conversations (conversation_id) VALUES (?)').run(id);
}

afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('SQLite conversation command approval persistence', () => {
  it('跨数据库重启恢复批准，重复保存不续期也不改写原事实', async () => {
    const databasePath = await createDatabasePath('restart');
    const firstDb = openDatabase(databasePath);
    const id = conversationId('conversation-approval-restart');
    seedConversation(firstDb, id);
    const firstPort = new SqliteConversationCommandApprovalPort(firstDb);
    const remembered = approval({ conversationId: id });

    await expect(firstPort.remember(remembered)).resolves.toEqual({
      status: 'created',
      approval: remembered,
    });
    await expect(firstPort.remember(remembered)).resolves.toEqual({
      status: 'existing',
      approval: remembered,
    });
    await expect(firstPort.remember({
      ...remembered,
      approvedAtMs: remembered.approvedAtMs + 10_000,
    })).rejects.toMatchObject({
      code: 'conversation_approval_identity_conflict',
      stage: 'remember',
    });
    await expect(firstPort.remember({
      ...remembered,
      candidate: candidate({ matcherRevision: 'simple-command-v2' }),
    })).rejects.toMatchObject({
      code: 'conversation_approval_identity_conflict',
      stage: 'remember',
    });
    await expect(firstPort.remember({
      ...remembered,
      approvedCwd: '/tmp/linnya-command-approval-other',
    })).rejects.toMatchObject({
      code: 'conversation_approval_identity_conflict',
      stage: 'remember',
    });
    firstDb.close();

    const restartedDb = openDatabase(databasePath);
    const restartedPort = new SqliteConversationCommandApprovalPort(restartedDb);
    await expect(restartedPort.listForConversation(id)).resolves.toEqual([remembered]);
  });

  it('按对话隔离完整 matcher 上下文，并支持幂等删除整段对话记忆', async () => {
    const databasePath = await createDatabasePath('scope');
    const db = openDatabase(databasePath);
    const firstConversation = conversationId('conversation-approval-first');
    const secondConversation = conversationId('conversation-approval-second');
    seedConversation(db, firstConversation);
    seedConversation(db, secondConversation);
    const port = new SqliteConversationCommandApprovalPort(db);
    const remembered = approval({ conversationId: firstConversation });
    const otherConversationApproval = approval({
      approvalRequestId: approvalRequestId(2),
      conversationId: secondConversation,
      candidate: candidate({ platform: 'windows', shellSemanticsId: 'powershell-5.1' }),
    });
    await port.remember(remembered);
    await port.remember(otherConversationApproval);

    await expect(port.listForConversation(firstConversation)).resolves.toEqual([remembered]);
    await expect(port.listForConversation(secondConversation))
      .resolves.toEqual([otherConversationApproval]);

    await expect(port.deleteForConversation(firstConversation)).resolves.toBeUndefined();
    await expect(port.deleteForConversation(firstConversation)).resolves.toBeUndefined();
    await expect(port.listForConversation(firstConversation)).resolves.toEqual([]);
    await expect(port.listForConversation(secondConversation))
      .resolves.toEqual([otherConversationApproval]);
  });

  it('按审批请求精准撤销，不误删同一命令的另一条并发批准', async () => {
    const databasePath = await createDatabasePath('revoke');
    const db = openDatabase(databasePath);
    const id = conversationId('conversation-approval-revoke');
    seedConversation(db, id);
    const port = new SqliteConversationCommandApprovalPort(db);
    const first = approval({
      approvalRequestId: approvalRequestId(11),
      conversationId: id,
      approvedAtMs: 100,
    });
    const second = approval({
      approvalRequestId: approvalRequestId(12),
      conversationId: id,
      approvedAtMs: 101,
    });
    await port.remember(first);
    await port.remember(second);

    await expect(port.revoke(first.approvalRequestId)).resolves.toBeUndefined();
    await expect(port.revoke(first.approvalRequestId)).resolves.toBeUndefined();
    await expect(port.listForConversation(id)).resolves.toEqual([second]);
  });

  it('损坏的持久批准明确失败，不把不可解释数据当成放行事实', async () => {
    const databasePath = await createDatabasePath('corrupt');
    const db = openDatabase(databasePath);
    const id = conversationId('conversation-approval-corrupt');
    seedConversation(db, id);
    const port = new SqliteConversationCommandApprovalPort(db);
    const remembered = approval({ conversationId: id });
    await port.remember(remembered);
    db.prepare(`
      UPDATE conversation_command_approvals
      SET approved_at_ms = 1.5
      WHERE conversation_id = ?
    `).run(id);

    await expect(port.listForConversation(id))
      .rejects.toMatchObject({
        code: 'conversation_approval_corrupt',
        stage: 'list',
      });
  });

  it('数据库连接失效时返回稳定持久化错误，不降级成内存批准', async () => {
    const databasePath = await createDatabasePath('closed');
    const db = openDatabase(databasePath);
    const id = conversationId('conversation-approval-closed');
    seedConversation(db, id);
    const port = new SqliteConversationCommandApprovalPort(db);
    db.close();

    await expect(port.remember(approval({ conversationId: id })))
      .rejects.toMatchObject({
        code: 'conversation_approval_persistence_failed',
        stage: 'remember',
      });
  });
});
