import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StorageSpaceOverviewResponseSchema } from '@app/schemas';
import Database from 'better-sqlite3';
import express from 'express';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteConversationStorageCatalogPort } from '../../app-hosts/linnya/adapters/persistence/storage-space/createSqliteConversationStorageCatalogPort';
import { SQLiteEventStore } from '../../app-hosts/linnya/adapters/persistence/event-store';
import { CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA } from '../../app-hosts/linnya/adapters/persistence/conversation-files';
import { createStorageSpaceUseCase } from '../../app-hosts/linnya/application/storage-space';
import {
  CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
} from '../../domains/conversation-files';
import { CORE_SCHEMAS } from '../workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from '../../domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { CONVERSATION_SCHEMAS } from '../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { createConversationRouteLifecycle } from '../../electron-main/routes/orchestration/createConversationRouteLifecycle';
import { createLocalManagedStorageInventoryPort } from '../../infra/adapters/storage-space/local-inventory';
import { createStorageSpaceRouter } from './storageSpace.router';

function createUserInput(conversationId: string): RuntimeEvent {
  return {
    id: 'storage-e2e-message',
    type: 'user_input',
    timestamp: 1_786_104_003_000,
    conversation_id: conversationId,
    turn_id: 'storage-e2e-turn',
    version: 1,
    content: '存储空间端到端测试',
    source: 'user',
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

describe('storage-space backend E2E', () => {
  const roots: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
  });

  it('从真实对话和磁盘返回概览，精准清理后保留聊天并更新工作文件状态', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-storage-e2e-app-'));
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-storage-e2e-workspace-'));
    roots.push(appDataRoot, workspaceRoot);
    const db = new Database(path.join(workspaceRoot, 'workspace.sqlite'));
    try {
      db.pragma('foreign_keys = ON');
      for (const ddl of [
        ...CORE_SCHEMAS,
        ...ASSET_LEDGER_SCHEMAS,
        ...CONVERSATION_SCHEMAS,
        ...CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
      ]) {
        db.exec(ddl);
      }

      const eventStore = new SQLiteEventStore(db);
      const conversationId = 'storage/e2e/conversation';
      const malformedConversationId = 'storage/e2e/malformed';
      await eventStore.ensureConversation(conversationId, [createUserInput(conversationId)]);
      await eventStore.ensureConversation(
        malformedConversationId,
        [createUserInput(malformedConversationId)],
      );
      const lifecycle = createConversationRouteLifecycle({
        db,
        eventStore,
        storageRoot: appDataRoot,
      });
      const workDirectoryPath = await lifecycle.workDirectoryAdmission.withAdmission(
        { conversationId },
        async directory => {
          await fsp.writeFile(path.join(directory.absolutePath, 'report.txt'), '123456789', 'utf8');
          return directory.absolutePath;
        },
      );
      const malformedWorkDirectoryPath = await lifecycle.workDirectoryAdmission.withAdmission(
        { conversationId: malformedConversationId },
        async directory => directory.absolutePath,
      );
      await fsp.rm(malformedWorkDirectoryPath, { recursive: true });
      await fsp.writeFile(malformedWorkDirectoryPath, 'externally replaced entry', 'utf8');
      const cleanup = lifecycle.bindCleanup({
        commands: {
          beginConversationStop() {},
          async stopConversationAndWait() {},
          forgetDeletedConversation() {},
        },
        approvals: { async deleteForConversation() {} },
        commandCardSettlements: {
          async drainConversation() {},
          async deleteForConversation() {},
        },
        async stopFlowAndWait() {},
      });
      const useCase = createStorageSpaceUseCase({
        catalog: createSqliteConversationStorageCatalogPort(db),
        inventory: createLocalManagedStorageInventoryPort({
          appDataRoot,
          workspaceRoot,
          conversationWorkFilesRoot: path.join(
            appDataRoot,
            CONVERSATION_WORK_DIRECTORY_NAMESPACE,
            'v1',
            CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
          ),
          attachmentRoots: [],
          diagnosticLogRoot: path.join(workspaceRoot, 'logs'),
          artifactsRoot: path.join(workspaceRoot, 'Artifacts', 'v1'),
        }),
        workDirectoryUsage: lifecycle.workDirectoryUsage,
        cleanup,
      });
      const app = express();
      app.use('/api/v1/storage-space', createStorageSpaceRouter(useCase));
      const server = createServer(app);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('storage-space E2E server did not expose a TCP address');
      }
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1/storage-space`;

      const beforeResponse = await fetch(`${baseUrl}/overview`);
      const before = StorageSpaceOverviewResponseSchema.parse(await beforeResponse.json());
      expect(beforeResponse.status).toBe(200);
      expect(before.conversations).toContainEqual(expect.objectContaining({
        conversation_id: conversationId,
        work_files_state: 'available',
        byte_size: 9,
        file_count: 1,
      }));
      expect(before.conversations).toContainEqual(expect.objectContaining({
        conversation_id: malformedConversationId,
        work_files_state: 'unavailable',
        byte_size: null,
        file_count: null,
      }));
      expect(before.categories.find(category => category.kind === 'conversation_work_files'))
        .toMatchObject({ byte_size: 34 });

      const clearResponse = await fetch(
        `${baseUrl}/conversations/${encodeURIComponent(conversationId)}/work-directory`,
        { method: 'DELETE' },
      );
      expect(clearResponse.status).toBe(204);
      await expect(fsp.lstat(workDirectoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(eventStore.getConversationMetadata(conversationId))
        .resolves.toMatchObject({ conversation_id: conversationId });

      const afterResponse = await fetch(`${baseUrl}/overview`);
      const after = StorageSpaceOverviewResponseSchema.parse(await afterResponse.json());
      expect(after.conversations).toContainEqual(expect.objectContaining({
        conversation_id: conversationId,
        work_files_state: 'previous_files_unavailable',
        byte_size: 0,
        file_count: 0,
      }));
      expect(after.conversations).toContainEqual(expect.objectContaining({
        conversation_id: malformedConversationId,
        work_files_state: 'unavailable',
        byte_size: null,
        file_count: null,
      }));
      expect(after.categories.find(category => category.kind === 'conversation_work_files'))
        .toMatchObject({ byte_size: 25 });
    } finally {
      db.close();
    }
  });
});
