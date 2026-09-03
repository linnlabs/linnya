import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';

import {
  PluginActiveVersionService,
  type PluginActiveVersionRecord,
} from '../../infrastructure/sqlite/plugin-active-version.service';
import {
  readActivePluginPointer,
  syncActivePluginPointer,
} from './activatePluginVersion';

export interface ReconcilePluginActiveVersionsOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly recordDiagnostic?: (diagnostic: {
    readonly level: 'warn' | 'error';
    readonly pluginId: PluginId;
    readonly message: string;
  }) => void;
}

export interface ReconcilePluginActiveVersionResult {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly status: 'already-synced' | 'synced' | 'rollback-adopted' | 'skipped-current-drift' | 'failed';
  readonly error?: string;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function reconcilePluginActiveVersions(
  options: ReconcilePluginActiveVersionsOptions,
): ReconcilePluginActiveVersionResult[] {
  const service = new PluginActiveVersionService(options.db);
  const results: ReconcilePluginActiveVersionResult[] = [];

  for (const record of service.listRecords()) {
    try {
      const activePointer = readActivePluginPointer(options.userPluginRoot, record.pluginId);
      if (
        activePointer?.version === record.activeVersion
        && (activePointer.previousVersion ?? null) === record.previousVersion
      ) {
        if (record.status !== 'active') {
          service.markActive({
            pluginId: record.pluginId,
            activeVersion: record.activeVersion,
            previousVersion: record.previousVersion,
          });
        }
        results.push({
          pluginId: record.pluginId,
          version: record.activeVersion,
          status: 'already-synced',
        });
        continue;
      }

      if (record.status === 'active' && activePointer?.version === record.previousVersion) {
        // 中文说明：active 状态表示新指针曾经成功写入；若磁盘现在已经回到
        // previous，说明后续加载失败触发了 runtime rollback。此时不能再把
        // broken 版本写回 active.json，而是承认当前运行时事实。
        service.markActive({
          pluginId: record.pluginId,
          activeVersion: activePointer.version,
          previousVersion: activePointer.previousVersion ?? null,
        });
        results.push({
          pluginId: record.pluginId,
          version: activePointer.version,
          status: 'rollback-adopted',
        });
        continue;
      }

      if (
        record.status !== 'active'
        && activePointer
        && activePointer.version !== record.activeVersion
        && activePointer.version !== record.previousVersion
      ) {
        service.markFailed({
          pluginId: record.pluginId,
          activeVersion: record.activeVersion,
          previousVersion: record.previousVersion,
          error: `active.json 已指向另一个版本: ${activePointer.version}`,
        });
        results.push({
          pluginId: record.pluginId,
          version: record.activeVersion,
          status: 'skipped-current-drift',
        });
        continue;
      }

      syncActivePluginPointer({
        userPluginRoot: options.userPluginRoot,
        pluginId: record.pluginId,
        version: record.activeVersion,
        previousVersion: record.previousVersion,
      });
      service.markActive({
        pluginId: record.pluginId,
        activeVersion: record.activeVersion,
        previousVersion: record.previousVersion,
      });
      results.push({
        pluginId: record.pluginId,
        version: record.activeVersion,
        status: 'synced',
      });
    } catch (error) {
      const message = readErrorMessage(error);
      service.markFailed({
        pluginId: record.pluginId,
        activeVersion: record.activeVersion,
        previousVersion: record.previousVersion,
        error: message,
      });
      options.recordDiagnostic?.({
        level: 'error',
        pluginId: record.pluginId,
        message: `插件 active 指针启动修复失败: ${message}`,
      });
      results.push({
        pluginId: record.pluginId,
        version: record.activeVersion,
        status: 'failed',
        error: message,
      });
    }
  }

  return results;
}
