import { describe, expect, it, vi } from 'vitest';

import {
  deriveConversationWorkDirectoryIdentity,
  type ConversationWorkDirectoryConversationId,
  ConversationWorkDirectoryUsagePort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCleanupUseCasePort,
} from '../../conversation-lifecycle';
import type {
  ConversationStorageCatalogPort,
  ManagedStorageInventoryPort,
} from '../index';
import { createStorageSpaceUseCase } from '../orchestration/createStorageSpaceUseCase';

function createCleanup(): ConversationCleanupUseCasePort {
  return {
    async requestWorkDirectoryClear() {
      return 'cleared';
    },
    async requestDeletion() {
      return true;
    },
    async readPendingConversationIds() {
      return new Set<string>();
    },
    async retryPending() {
      return 'not_found';
    },
    async recoverPending() {
      return {
        listedCount: 0,
        completedCount: 0,
        supersededCount: 0,
        failures: [],
      };
    },
  };
}

function conversationId(value: string): ConversationWorkDirectoryConversationId {
  return deriveConversationWorkDirectoryIdentity(value).conversationId;
}

describe('storage-space use case', () => {
  it('组合全 project catalog、三种工作文件状态和六类互斥物理总量', async () => {
    const catalog: ConversationStorageCatalogPort = {
      listAll: () => [
        {
          conversationId: conversationId('conversation-small'),
          title: '小目录',
          projectId: null,
          lastEventAt: 30,
        },
        {
          conversationId: conversationId('conversation-large'),
          title: '大目录',
          projectId: 'project-a',
          lastEventAt: 20,
        },
        {
          conversationId: conversationId('conversation-missing'),
          title: '原文件不可用',
          projectId: 'project-b',
          lastEventAt: 10,
        },
      ],
    };
    const workDirectoryUsage: ConversationWorkDirectoryUsagePort = {
      async measureWorkDirectory(identity) {
        if (identity.conversationId === 'conversation-large') {
          return { identity, state: 'available', byteSize: 20, fileCount: 2 };
        }
        if (identity.conversationId === 'conversation-small') {
          return { identity, state: 'available', byteSize: 5, fileCount: 1 };
        }
        return {
          identity,
          state: 'previous_files_unavailable',
          byteSize: 0,
          fileCount: 0,
        };
      },
    };
    const inventory: ManagedStorageInventoryPort = {
      async measure() {
        return {
          total: { byteSize: 100, fileCount: 10 },
          categories: [
            { kind: 'conversation_work_files', byteSize: 25, fileCount: 3 },
            { kind: 'workspace', byteSize: 30, fileCount: 2 },
            { kind: 'attachments', byteSize: 15, fileCount: 1 },
            { kind: 'temporary_outputs', byteSize: 10, fileCount: 2 },
            { kind: 'diagnostic_logs', byteSize: 5, fileCount: 1 },
            { kind: 'application_data', byteSize: 15, fileCount: 1 },
          ],
        };
      },
    };

    const overview = await createStorageSpaceUseCase({
      catalog,
      inventory,
      workDirectoryUsage,
      cleanup: createCleanup(),
      now: () => 1_786_104_001_000,
    }).readOverview();

    expect(overview).toMatchObject({
      measuredAtMs: 1_786_104_001_000,
      total: { byteSize: 100, fileCount: 10 },
    });
    expect(overview.conversations.map(conversation => ({
      id: conversation.conversationId,
      project: conversation.projectId,
      state: conversation.workFilesState,
      bytes: conversation.byteSize,
    }))).toEqual([
      { id: 'conversation-large', project: 'project-a', state: 'available', bytes: 20 },
      { id: 'conversation-small', project: null, state: 'available', bytes: 5 },
      {
        id: 'conversation-missing',
        project: 'project-b',
        state: 'previous_files_unavailable',
        bytes: 0,
      },
    ]);
  });

  it('精准清理只转交唯一 lifecycle use case，并原样保留稳定结果', async () => {
    const cleanup = createCleanup();
    const request = vi.spyOn(cleanup, 'requestWorkDirectoryClear')
      .mockResolvedValue('deletion_in_progress');
    const useCase = createStorageSpaceUseCase({
      catalog: { listAll: () => [] },
      inventory: {
        async measure() {
          return { total: { byteSize: 0, fileCount: 0 }, categories: [] };
        },
      },
      workDirectoryUsage: {
        async measureWorkDirectory() {
          throw new Error('empty catalog must not measure a directory');
        },
      },
      cleanup,
    });

    await expect(useCase.clearConversationWorkDirectory('conversation/encoded'))
      .resolves.toBe('deletion_in_progress');
    expect(request).toHaveBeenCalledWith('conversation/encoded');
  });

  it('单个对话目录计量失败时标为 unavailable，不伪装成 0 或拖垮其他结果', async () => {
    const useCase = createStorageSpaceUseCase({
      catalog: {
        listAll: () => [
          {
            conversationId: conversationId('conversation-healthy'),
            title: '正常',
            projectId: null,
            lastEventAt: 2,
          },
          {
            conversationId: conversationId('conversation-failure'),
            title: '失败',
            projectId: null,
            lastEventAt: 1,
          },
        ],
      },
      inventory: {
        async measure() {
          return { total: { byteSize: 9, fileCount: 1 }, categories: [] };
        },
      },
      workDirectoryUsage: {
        async measureWorkDirectory(identity) {
          if (identity.conversationId === 'conversation-failure') {
            throw new Error('measurement failed');
          }
          return { identity, state: 'available', byteSize: 9, fileCount: 1 };
        },
      },
      cleanup: createCleanup(),
    });

    await expect(useCase.readOverview()).resolves.toMatchObject({
      total: { byteSize: 9, fileCount: 1 },
      conversations: [
        {
          conversationId: 'conversation-healthy',
          workFilesState: 'available',
          byteSize: 9,
          fileCount: 1,
        },
        {
          conversationId: 'conversation-failure',
          workFilesState: 'unavailable',
          byteSize: null,
          fileCount: null,
        },
      ],
    });
  });

  it('物理总盘点失败时拒绝 overview，不把未知总量伪装成部分结果', async () => {
    const useCase = createStorageSpaceUseCase({
      catalog: { listAll: () => [] },
      inventory: {
        async measure() {
          throw new Error('inventory failed');
        },
      },
      workDirectoryUsage: {
        async measureWorkDirectory() {
          throw new Error('empty catalog must not measure a directory');
        },
      },
      cleanup: createCleanup(),
    });

    await expect(useCase.readOverview()).rejects.toThrow('inventory failed');
  });
});
