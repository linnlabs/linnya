import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from 'linnkit/contracts';

import {
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
} from '../../../domains/conversation-files';
import { CORE_SCHEMAS } from '../../../features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from '../../../domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../app-hosts/linnya/adapters/persistence/conversation-files';
import {
  SQLiteEventStore,
} from '../../../app-hosts/linnya/adapters/persistence/event-store';
import {
  CONVERSATION_SCHEMAS,
} from '../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { createConversationRouteLifecycle } from './createConversationRouteLifecycle';

function createUserInput(conversationId: string): RuntimeEvent {
  return {
    id: `message-${conversationId}`,
    type: 'user_input',
    timestamp: 1_785_499_300_000,
    conversation_id: conversationId,
    turn_id: `turn-${conversationId}`,
    version: 1,
    content: `seed ${conversationId}`,
    source: 'user',
  };
}

function metadataPaths(storageRoot: string, conversationId: string): readonly string[] {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  const metadataRoot = path.join(
    storageRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  );
  return [
    path.join(metadataRoot, `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`),
    path.join(
      metadataRoot,
      `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX}`,
    ),
  ];
}

async function expectMissing(targetPath: string): Promise<void> {
  await expect(fsp.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('createConversationRouteLifecycle', () => {
  it('同一 scope 贯穿目录准入、请求删除、not found 与持久任务恢复', async () => {
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-route-lifecycle-'));
    const db = new Database(path.join(storageRoot, 'workspace.sqlite'));
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
      const lifecycle = createConversationRouteLifecycle({ db, eventStore, storageRoot });
      const commandBegins: string[] = [];
      const commandStops: string[] = [];
      const commandForgets: string[] = [];
      const flowStops: string[] = [];
      const approvalDeletes: string[] = [];
      const cleanup = lifecycle.bindCleanup({
        commands: {
          beginConversationStop(conversationId) {
            commandBegins.push(conversationId);
          },
          async stopConversationAndWait(conversationId) {
            commandStops.push(conversationId);
          },
          forgetDeletedConversation(conversationId) {
            commandForgets.push(conversationId);
          },
        },
        approvals: {
          async deleteForConversation(conversationId) {
            approvalDeletes.push(conversationId);
          },
        },
        commandCardSettlements: {
          async drainConversation(): Promise<void> {},
          async deleteForConversation(): Promise<void> {},
        },
        async stopFlowAndWait(conversationId) {
          flowStops.push(conversationId);
        },
      });
      const cleanupJobs = new SqliteConversationDirectoryCleanupJobPort(db);

      const clearedConversationId = 'conversation-route-clear-request';
      await eventStore.ensureConversation(
        clearedConversationId,
        [createUserInput(clearedConversationId)],
      );
      const clearedDirectory = await lifecycle.workDirectoryAdmission.withAdmission({
        conversationId: clearedConversationId,
      }, async (directory) => {
        await fsp.writeFile(path.join(directory.absolutePath, 'clear.txt'), 'clear', 'utf8');
        return directory.absolutePath;
      });
      await expect(lifecycle.workDirectoryUsage.measureWorkDirectory(
        deriveConversationWorkDirectoryIdentity(clearedConversationId),
      )).resolves.toMatchObject({
        state: 'available',
        byteSize: 5,
        fileCount: 1,
      });
      await expect(cleanup.requestWorkDirectoryClear(clearedConversationId))
        .resolves.toBe('cleared');
      await expectMissing(clearedDirectory);
      await expect(lifecycle.workDirectoryUsage.measureWorkDirectory(
        deriveConversationWorkDirectoryIdentity(clearedConversationId),
      )).resolves.toMatchObject({
        state: 'previous_files_unavailable',
        byteSize: 0,
        fileCount: 0,
      });
      for (const markerPath of metadataPaths(storageRoot, clearedConversationId)) {
        await expect(fsp.lstat(markerPath)).resolves.toMatchObject({});
      }
      await expect(eventStore.getConversationMetadata(clearedConversationId))
        .resolves.toMatchObject({ conversation_id: clearedConversationId });
      await expect(cleanupJobs.list()).resolves.toEqual([]);

      const requestedConversationId = 'conversation-route-delete-request';
      await eventStore.ensureConversation(
        requestedConversationId,
        [createUserInput(requestedConversationId)],
      );
      const requestedDirectory = await lifecycle.workDirectoryAdmission.withAdmission({
        conversationId: requestedConversationId,
      }, async (directory) => {
        await fsp.writeFile(path.join(directory.absolutePath, 'request.txt'), 'request', 'utf8');
        return directory.absolutePath;
      });

      await expect(cleanup.requestDeletion(requestedConversationId)).resolves.toBe(true);
      await expectMissing(requestedDirectory);
      for (const markerPath of metadataPaths(storageRoot, requestedConversationId)) {
        await expectMissing(markerPath);
      }
      await expect(eventStore.getConversationMetadata(requestedConversationId)).resolves.toBeNull();
      await expect(cleanupJobs.list()).resolves.toEqual([]);

      const callsAfterRequest = {
        commandBegins: commandBegins.length,
        commandStops: commandStops.length,
        commandForgets: commandForgets.length,
        flowStops: flowStops.length,
        approvalDeletes: approvalDeletes.length,
      };
      await expect(cleanup.requestDeletion('conversation-route-delete-missing'))
        .resolves.toBe(false);
      expect({
        commandBegins: commandBegins.length,
        commandStops: commandStops.length,
        commandForgets: commandForgets.length,
        flowStops: flowStops.length,
        approvalDeletes: approvalDeletes.length,
      }).toEqual(callsAfterRequest);

      const recoveredConversationId = 'conversation-route-delete-recovery';
      await eventStore.ensureConversation(
        recoveredConversationId,
        [createUserInput(recoveredConversationId)],
      );
      const recoveredDirectory = await lifecycle.workDirectoryAdmission.withAdmission({
        conversationId: recoveredConversationId,
      }, async (directory) => {
        await fsp.writeFile(path.join(directory.absolutePath, 'recovery.txt'), 'recovery', 'utf8');
        return directory.absolutePath;
      });
      const recoveredIdentity = deriveConversationWorkDirectoryIdentity(recoveredConversationId);
      await cleanupJobs.begin(createConversationDirectoryCleanupJob({
        jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000951',
        identity: recoveredIdentity,
        operation: 'delete_conversation',
        requestedAt: 1_785_499_300_951,
      }));

      await expect(cleanup.recoverPending()).resolves.toEqual({
        listedCount: 1,
        completedCount: 1,
        supersededCount: 0,
        failures: [],
      });
      await expectMissing(recoveredDirectory);
      for (const markerPath of metadataPaths(storageRoot, recoveredConversationId)) {
        await expectMissing(markerPath);
      }
      await expect(eventStore.getConversationMetadata(recoveredConversationId)).resolves.toBeNull();
      await expect(cleanupJobs.list()).resolves.toEqual([]);

      expect(commandBegins).toEqual([
        clearedConversationId,
        clearedConversationId,
        requestedConversationId,
        requestedConversationId,
        recoveredConversationId,
        recoveredConversationId,
      ]);
      expect(commandStops).toEqual([
        clearedConversationId,
        requestedConversationId,
        recoveredConversationId,
      ]);
      expect(flowStops).toEqual([
        clearedConversationId,
        requestedConversationId,
        recoveredConversationId,
      ]);
      expect(approvalDeletes).toEqual([requestedConversationId, recoveredConversationId]);
      expect(commandForgets).toEqual([requestedConversationId, recoveredConversationId]);
    } finally {
      if (db.open) db.close();
      await fsp.rm(storageRoot, { recursive: true, force: true });
    }
  });
});
