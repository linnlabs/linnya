import { describe, expect, it, vi } from 'vitest';

import type { UpdateMessageChannel } from '../../../shared/update/definitions/updateMessage';
import {
  configureInstallDownloadedUpdateRequest,
  installDownloadedUpdate,
} from './installDownloadedUpdate';

function createOptions() {
  const statuses: UpdateMessageChannel[] = [];
  return {
    statuses,
    options: {
      source: 'integration-test',
      sendStatus: (channel: UpdateMessageChannel) => statuses.push(channel),
      log: vi.fn(),
      logError: vi.fn(),
    },
  };
}

describe('installDownloadedUpdate', () => {
  it('稍后更新恢复 downloaded 状态，不发布 installing', async () => {
    const cleanup = configureInstallDownloadedUpdateRequest(async () => 'kept_open');
    const fixture = createOptions();
    try {
      await expect(installDownloadedUpdate(fixture.options)).resolves.toEqual({
        success: true,
        alreadyRequested: false,
        outcome: 'kept_open',
      });
      expect(fixture.statuses).toEqual(['update-downloaded']);
    } finally {
      cleanup();
    }
  });

  it('只有 owner 提交 install_update 后才发布 installing', async () => {
    const fixture = createOptions();
    const cleanup = configureInstallDownloadedUpdateRequest(async onCommitted => {
      expect(fixture.statuses).toEqual([]);
      onCommitted();
      return 'shutdown_committed';
    });
    try {
      await expect(installDownloadedUpdate(fixture.options)).resolves.toEqual({
        success: true,
        alreadyRequested: false,
        outcome: 'shutdown_committed',
      });
      expect(fixture.statuses).toEqual(['installing']);
    } finally {
      cleanup();
    }
  });

  it('未下载完成时返回明确失败且不伪装安装中', async () => {
    const cleanup = configureInstallDownloadedUpdateRequest(async () => 'update_not_ready');
    const fixture = createOptions();
    try {
      await expect(installDownloadedUpdate(fixture.options)).resolves.toEqual({
        success: false,
        alreadyRequested: false,
        outcome: 'update_not_ready',
      });
      expect(fixture.statuses).toEqual(['error']);
    } finally {
      cleanup();
    }
  });
});
