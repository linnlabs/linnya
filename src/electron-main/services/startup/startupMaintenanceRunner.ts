/**
 * @file src/electron-main/services/startup/startupMaintenanceRunner.ts
 *
 * 启动后一次性维护任务编排器（Phase 2 - Startup Maintenance）
 *
 * 设计目标：
 * - 把各模块的“清理/修复/一致性检查”函数集中编排调用
 * - 仅在启动后执行一次（不常驻、不定时），避免引入额外运行期开销与竞态
 * - 日志只输出必要的 summary（不泄漏内容/算法细节，避免日志膨胀）
 */

import { setTimeout as delay } from 'node:timers/promises';

import { Logger } from '../../../shared/logger';

import type { DatabaseService } from '../database';

import { runWorkspaceMaintenanceOnce } from '../workspace/workspace-maintenance';
import { runConversationMaintenanceOnce } from '../conversation/conversation-maintenance';
import { runStartupLogMaintenanceOnce } from './log-maintenance';
import {
  collectOrphanManagedImageAssets,
  recoverPendingManagedImagePublishesFromLedger,
} from '../../../domains/assets/features/managed-image-maintenance';
import { ensureManagedImageStoreBinding } from '../../../domains/assets/features/managed-image-store-binding';
import {
  getAppDataPath,
  getConversationArtifactsV1Path,
  getWorkspaceRoot,
} from '../../../shared/utils/pathManager';
import { cleanupToolOutputStoreByTime } from '../../../tools/tool_output/orchestration/cleanupToolOutputStore';
import { reclaimFreePagesInBatches } from '../database/reclaimFreePagesInBatches';
import { createFileCommandOutputArtifactMaintenancePort } from '../../../infra/adapters/command-runtime/output/createFileCommandOutputArtifactMaintenancePort';

export interface StartupMaintenanceDeps {
  databaseService: DatabaseService;
}

export interface StartupMaintenanceOptions {
  /**
   * 延迟执行（ms）：用于给 Qdrant / DB / IPC 初始化留出余量
   */
  initialDelayMs?: number;
}

export interface ManagedImageStartupMaintenanceDeps {
  readonly databaseService: DatabaseService;
}

export interface StartupMaintenanceLifecycle {
  /** 取消尚未开始的维护；已开始的存储操作完成后才允许释放依赖。 */
  stop(): Promise<void>;
}

/**
 * 受管图片维护必须在任何上传、工具或会话入口开放前完成。
 *
 * 内容寻址路径会被相同 bytes 复用；若像普通维护任务一样延迟执行，旧孤儿
 * asset 删除与新 ingress 可能争用同一路径，导致新文件被旧回收任务删除。
 */
export async function runManagedImageStartupMaintenance(
  deps: ManagedImageStartupMaintenanceDeps
): Promise<void> {
  const logger = new Logger('ManagedImageStartupMaintenance');
  const db = deps.databaseService.getDb();
  // store identity 是后续路由与 ingress 的必需装配事实；无法建立时必须在启动边界失败，
  // 不能先吞错、再让业务入口以“绑定缺失”二次失败。
  const { storeId } = ensureManagedImageStoreBinding({ db });
  try {
    const orphanAssets = await collectOrphanManagedImageAssets({
      db,
      appDataRoot: getAppDataPath(),
      storeId,
      logger,
      createdBeforeMs: Date.now() - process.uptime() * 1_000,
    });
    const pendingStats = await recoverPendingManagedImagePublishesFromLedger({
      db,
      appDataRoot: getAppDataPath(),
      storeId,
      logger,
      quarantineRetentionMs: 30 * 24 * 60 * 60 * 1_000,
    });
    logger.info(
      `受管图片维护汇总: orphanAssets=${orphanAssets.deletedAssets}, orphanFiles=${orphanAssets.deletedFiles}, ` +
        `orphanFileFailed=${orphanAssets.failedFiles}, ` +
        `pendingScanned=${pendingStats.scanned}, pendingCompleted=${pendingStats.completed}, ` +
        `pendingQuarantined=${pendingStats.quarantined}, quarantineDeleted=${pendingStats.quarantineDeleted}, ` +
        `pendingFailed=${pendingStats.failed}`
    );
  } catch (error: unknown) {
    // 维护失败不能阻止用户打开应用；关键是失败任务已经结束，不会与 ingress 并发。
    logger.warn(
      `受管图片启动维护执行失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * ToolOutputStore 的崩溃残留清理必须在工具入口开放前结束。
 *
 * writer 采用 manifest-last 发布；若沿用十秒后的普通维护，清理会把正在写入的 staging
 * 或尚未发布 manifest 的目录误判为孤儿。这里与受管图片维护一样同步等待，但失败只记日志，
 * 保证清理任务已经停止后再继续启动，不与本进程的新 writer 并发。
 */
export async function runToolOutputStoreStartupMaintenance(
  protectedConversationIds?: ReadonlySet<string>
): Promise<void> {
  const logger = new Logger('ToolOutputStoreStartupMaintenance');
  const retentionDays = 7;
  try {
    const stats = await cleanupToolOutputStoreByTime({
      logger,
      retentionDays,
      workspaceRoot: getWorkspaceRoot(),
      protectedConversationIds,
    });
    logger.info(
      `ToolOutputStore 启动清理完成: retentionDays=${retentionDays}, ` +
        `scanned=${stats.scanned}, deleted=${stats.deleted}, failed=${stats.failed}`
    );
  } catch (error: unknown) {
    logger.warn(
      `ToolOutputStore 启动清理执行失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * raw byte 与 Agent 文本有不同的 schema 和到期事实，因此共用启动时机但不共用清理器。
 * 必须在命令入口开放前等待结束，避免旧 artifact 扫描与本进程的新 writer 并发。
 */
export async function runCommandOutputArtifactStartupMaintenance(input?: {
  readonly storageRoot?: string;
  readonly nowMs?: number;
  readonly protectedConversationIds?: ReadonlySet<string>;
}): Promise<void> {
  const logger = new Logger('CommandOutputArtifactStartupMaintenance');
  const storageRoot = input?.storageRoot ?? getConversationArtifactsV1Path();
  try {
    const maintenance = createFileCommandOutputArtifactMaintenancePort({ storageRoot, logger });
    const stats = await maintenance.cleanupExpired({
      nowMs: input?.nowMs ?? Date.now(),
      protectedConversationIds: input?.protectedConversationIds,
    });
    logger.info(
      `原始命令输出启动清理完成: scanned=${stats.scanned}, retained=${stats.retained}, ` +
        `deleted=${stats.deleted}, failed=${stats.failed}`
    );
  } catch (error: unknown) {
    logger.warn(
      `原始命令输出启动清理执行失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 调度启动后一次性维护任务（只会执行一次）
 */
export function scheduleStartupMaintenanceOnce(
  deps: StartupMaintenanceDeps,
  options?: StartupMaintenanceOptions
): StartupMaintenanceLifecycle {
  const controller = new AbortController();
  const { signal } = controller;
  const logger = new Logger('StartupMaintenance');
  const initialDelayMs =
    typeof options?.initialDelayMs === 'number' &&
    Number.isFinite(options.initialDelayMs) &&
    options.initialDelayMs >= 0
      ? options.initialDelayMs
      : 10_000;

  logger.info(`已调度启动维护任务：首次延迟 ${initialDelayMs} ms（仅启动一次）`);

  const completion = (async () => {
    await delay(initialDelayMs, undefined, { signal });
    const start = Date.now();
    logger.info('🚀 启动维护任务开始');

    // 0) 日志目录维护（仅删历史日志，不触碰当前活跃文件）
    try {
      await runStartupLogMaintenanceOnce({ logger });
    } catch (e) {
      logger.warn(`日志维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (signal.aborted) return;

    // 1) Workspace 清理（SQLite 内部；只复查挂有卫星数据的 Markdown 文档，逐篇让出事件循环）
    try {
      await runWorkspaceMaintenanceOnce(deps.databaseService);
    } catch (e) {
      logger.warn(`Workspace 维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (signal.aborted) return;

    // 1.5) Conversation 维护（SQLite 内部，轻量）
    // 受管图片迁移与 GC 已在路由开放前同步完成，不能放回本延迟任务。
    // project_id IS NULL 的会话归属于 Linnya 助手，启动时必须保留。
    try {
      await runConversationMaintenanceOnce(deps.databaseService);
    } catch (e) {
      logger.warn(`Conversation 维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (signal.aborted) return;

    // 1.6) 把数据库空闲页小步归还磁盘（仅 v70 起新建、开启增量回收的库；旧库直接跳过）
    try {
      const reclaimedPages = await reclaimFreePagesInBatches(deps.databaseService, signal);
      if (reclaimedPages > 0) logger.info(`数据库已归还 ${reclaimedPages} 个空闲页`);
    } catch (e) {
      logger.warn(`数据库空闲页回收失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (signal.aborted) return;

    logger.info(`✅ 启动维护任务结束: costMs=${Date.now() - start}`);
  })().catch((error: unknown) => {
    if (signal.aborted) return;
    logger.error(`启动维护执行失败: ${error instanceof Error ? error.message : String(error)}`);
  });

  return Object.freeze({
    stop() {
      // 不能仅 unref 定时器：退出期间维护仍可能访问已经关闭的数据库或 Qdrant。
      controller.abort();
      return completion;
    },
  });
}
