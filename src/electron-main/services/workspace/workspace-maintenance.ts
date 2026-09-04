/**
 * @file workspace-maintenance.ts
 * @description Workspace 级后台维护任务（例如清理幽灵块数据）。
 *
 * 当前策略（与稳定性目标对齐）：
 * - 仅在“启动后”执行一次（不做常驻定时器），避免引入运行期资源消耗与并发竞态；
 * - 由启动维护编排器统一调度（见 `electron-main/services/startup/startupMaintenanceRunner.ts`）。
 */

import type { DatabaseService } from '../database';
import Database from 'better-sqlite3';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { MarkdownNormalizationService } from 'src/domains/markdown';
import { MarkdownOrphanBlockDataCleaner } from 'src/domains/markdown';
import { Logger } from '../../../shared/logger';

/**
 * 执行一次 Workspace 维护任务（目前仅：清理 Markdown 幽灵块数据）。
 *
 * 注意：
 * - 此函数应在 DatabaseService 初始化完成后调用；
 * - 只做 SQLite 内部清理，不触碰知识库三源（Qdrant/SoT/KB 元数据）。
 */
export async function runWorkspaceMaintenanceOnce(databaseService: DatabaseService): Promise<void> {
  const logger = new Logger('WorkspaceMaintenance');
  try {
    const db: Database.Database = databaseService.getDb();

    // 构造所需的服务实例（轻量级）
    const markdownService = new MarkdownDocumentService(db);
    const normalizationService = new MarkdownNormalizationService(db, markdownService);
    const cleaner = new MarkdownOrphanBlockDataCleaner(db, markdownService);

    logger.info('🧹 启动维护：开始执行幽灵块数据清理任务...');

    // 1) 找出所有有效的 Markdown 文档节点
    const stmtDocs = db.prepare<unknown[], { id: string }>(`
      SELECT id
      FROM workspace_nodes
      WHERE type = 'document' AND deleted_at IS NULL
    `);
    const docs = stmtDocs.all();

    let totalRemovedPending = 0;
    let totalRemovedBlockVersions = 0;
    let failedDocs = 0;

    // 2) 逐文档清理（默认只在有删除时记录单条 info，避免日志膨胀）
    for (const row of docs) {
      const documentId = row.id;
      try {
        const result = cleaner.cleanupDocumentOrphans(documentId);
        totalRemovedPending += result.removedPending;
        totalRemovedBlockVersions += result.removedBlockVersions;

        if (
          result.removedPending > 0 ||
          result.removedBlockVersions > 0
        ) {
          logger.info(
            `文档清理: documentId=${documentId}, ` +
              `pending=${result.removedPending}, blockVersions=${result.removedBlockVersions}`
          );
        }
      } catch (err) {
        failedDocs += 1;
        logger.warn(
          `清理文档失败: documentId=${documentId}, err=${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 3) 汇总日志（关键：始终仅输出一条 summary）
    logger.info(
      `✅ 启动维护：幽灵块清理完成. docs=${docs.length}, failed=${failedDocs}, ` +
        `removed(pending=${totalRemovedPending}, blockVersions=${totalRemovedBlockVersions})`
    );

    // 3.5) 占位 Markdown 文档规范化
    const normalizationStats = await normalizationService.normalizeAllPendingPlaceholders();
    logger.info(
      `✅ 启动维护：Markdown 占位文档规范化完成. scanned=${normalizationStats.scanned}, normalized=${normalizationStats.normalized}, skipped=${normalizationStats.skipped}, failed=${normalizationStats.failed}`
    );

  } catch (error) {
    logger.error(
      `❌ 启动维护：幽灵块数据清理任务执行失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
