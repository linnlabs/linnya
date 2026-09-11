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

import { Logger } from '../../../shared/logger';

import type { DatabaseService } from '../database';
import type { MetadataRepository } from '../../../features/knowledge-base/infrastructure/metadataRepository';
import type { QdrantRepository } from '../../../features/knowledge-base/infrastructure/qdrantRepository';
import type { SotRepository } from '../../../features/knowledge-base/infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../../../features/knowledge-base/infrastructure/originalDocumentRepository';
import { BetterSqliteKnowledgeGraphRepository } from '../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';

import { runWorkspaceMaintenanceOnce } from '../workspace/workspace-maintenance';
import { runConversationMaintenanceOnce } from '../conversation/conversation-maintenance';
import { runKnowledgeBaseStartupMaintenanceOnce } from '../../../features/knowledge-base/ingestion/failureCleanup';
import { runChunkCollectionStartupMaintenanceOnce } from '../../../features/knowledge-base/infrastructure/qdrant-repository/startupChunkCollectionMaintenance';
import { runStartupLogMaintenanceOnce } from './log-maintenance';
import {
  collectOrphanManagedImageAssets,
  migrateLegacyManagedImages,
  recoverPendingManagedImagePublishesFromLedger,
} from '../../../domains/assets/features/managed-image-maintenance';
import { ensureManagedImageStoreBinding } from '../../../domains/assets/features/managed-image-store-binding';
import {
  getAppDataPath,
  getConversationArtifactsV1Path,
  getWorkspaceRoot,
} from '../../../shared/utils/pathManager';
import { LINNYA_FLOW_IMAGE_INGRESS_POLICY } from '../../../app-hosts/linnya/adapters/flow/incoming-events/definitions/flowImageIngressPolicy';
import { cleanupToolOutputStoreByTime } from '../../../tools/tool_output/orchestration/cleanupToolOutputStore';
import { createFileCommandOutputArtifactMaintenancePort } from '../../../infra/adapters/command-runtime/output/createFileCommandOutputArtifactMaintenancePort';

export interface StartupMaintenanceDeps {
  databaseService: DatabaseService;
  metadataRepository: MetadataRepository;
  qdrantRepository: QdrantRepository;
  sotRepository: SotRepository;
  originalDocumentRepository: OriginalDocumentRepository;
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

let scheduled = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待 Qdrant 服务“可达”（reachable）。
 *
 * 说明：
 * - 我们不要求某个集合一定存在；只要能对 `collectionExists('default')` 给出确定响应即可
 * - 若 Qdrant 未就绪/不可达，QdrantAdapter 会抛出非404错误；这里捕获并重试
 *
 * 为什么要做这个：
 * - 启动早期 Qdrant 慢启动时，“不可达”会被误判为“集合不存在/为空”
 * - 继而触发知识库维护中的破坏性清理（极小概率全量误删）
 * - 因此维护任务必须在“Qdrant 可达”之后才允许执行
 */
async function waitForQdrantReachable(params: {
  qdrantRepository: QdrantRepository;
  logger: Logger;
  maxWaitMs: number;
  pollIntervalMs: number;
}): Promise<boolean> {
  const { qdrantRepository, logger, maxWaitMs, pollIntervalMs } = params;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await qdrantRepository.collectionExists('default');
      return true;
    } catch (e) {
      logger.warn(
        `Qdrant 未就绪，等待重试中... costMs=${Date.now() - start}, err=${e instanceof Error ? e.message : String(e)}`
      );
      await sleep(pollIntervalMs);
    }
  }
  return false;
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
    const attachmentMigration = await migrateLegacyManagedImages({
      db,
      appDataRoot: getAppDataPath(),
      storeId,
      workspaceRoot: getWorkspaceRoot(),
      maxImagePixels: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImagePixels,
      logger,
    });
    const orphanAssets = await collectOrphanManagedImageAssets({
      db,
      appDataRoot: getAppDataPath(),
      storeId,
      workspaceRoot: getWorkspaceRoot(),
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
      `受管图片维护汇总: legacyMigrated=${attachmentMigration.migrated}/${attachmentMigration.scanned}, ` +
        `migrationSkipped=${attachmentMigration.skipped}, migrationFailed=${attachmentMigration.failed}, ` +
        `orphanAssets=${orphanAssets.deletedAssets}, orphanFiles=${orphanAssets.deletedFiles}, ` +
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
): void {
  if (scheduled) return;
  scheduled = true;

  const logger = new Logger('StartupMaintenance');
  const initialDelayMs =
    typeof options?.initialDelayMs === 'number' &&
    Number.isFinite(options.initialDelayMs) &&
    options.initialDelayMs >= 0
      ? options.initialDelayMs
      : 10_000;

  logger.info(`已调度启动维护任务：首次延迟 ${initialDelayMs} ms（仅启动一次）`);

  setTimeout(async () => {
    const start = Date.now();
    logger.info('🚀 启动维护任务开始');

    // 0) 日志目录维护（仅删历史日志，不触碰当前活跃文件）
    try {
      await runStartupLogMaintenanceOnce({ logger });
    } catch (e) {
      logger.warn(`日志维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 1) Workspace 清理（SQLite 内部，轻量）
    try {
      await runWorkspaceMaintenanceOnce(deps.databaseService);
    } catch (e) {
      logger.warn(`Workspace 维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 1.5) Conversation 维护（SQLite 内部，轻量）
    // 受管图片迁移与 GC 已在路由开放前同步完成，不能放回本延迟任务。
    // project_id IS NULL 的会话归属于 Linnya 助手，启动时必须保留。
    try {
      await runConversationMaintenanceOnce(deps.databaseService);
    } catch (e) {
      logger.warn(`Conversation 维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2) 知识库一致性清理（SQLite + SoT + Qdrant）
    try {
      /**
       * 根因修复（稳健性）：
       * - 在执行知识库三源一致性维护前，必须确保 Qdrant “可达”
       * - 否则不可达会被误判为缺失，从而触发破坏性清理
       *
       * 这里等待一段时间（最多 2 分钟），仍不可达则跳过本轮知识库维护（不做破坏性动作）
       */
      const qdrantReachable = await waitForQdrantReachable({
        qdrantRepository: deps.qdrantRepository,
        logger,
        maxWaitMs: 120_000,
        pollIntervalMs: 5_000,
      });
      if (!qdrantReachable) {
        logger.warn(
          'Qdrant 在启动维护窗口内仍不可达，跳过本轮知识库维护（避免误删），后续可由用户/后台触发再次维护'
        );
        logger.info(`✅ 启动维护任务结束(跳过知识库维护): costMs=${Date.now() - start}`);
        return;
      }

      const stats = await runKnowledgeBaseStartupMaintenanceOnce(
        deps.metadataRepository,
        deps.qdrantRepository,
        deps.sotRepository,
        new BetterSqliteKnowledgeGraphRepository(deps.databaseService),
        deps.originalDocumentRepository
      );
      logger.info(
        `知识库维护汇总: totalFailed=${stats.totalFailed}, sqliteCleared=${stats.sqliteCleared}, qdrantCleared=${stats.qdrantCleared}, sotCleared=${stats.sotCleared}`
      );

      const chunkStats = await runChunkCollectionStartupMaintenanceOnce(
        deps.metadataRepository,
        deps.qdrantRepository
      );
      logger.info(
        `chunk collection 启动维护汇总: scanned=${chunkStats.scannedCollections}, recreated=${chunkStats.recreatedCollections}, deletedEmpty=${chunkStats.deletedEmptyCollections}, skipped=${chunkStats.skippedCollections}, failed=${chunkStats.failedCollections}`
      );
    } catch (e) {
      logger.error(`知识库维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    logger.info(`✅ 启动维护任务结束: costMs=${Date.now() - start}`);
  }, initialDelayMs);
}
