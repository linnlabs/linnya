import { createMarkdownDocumentStore } from 'src/app-hosts/linnya/application/markdown-image-assets';
/**
 * @file workspace-maintenance.ts
 * @description Workspace 级后台维护任务（例如清理幽灵块数据）。
 *
 * 当前策略（与稳定性目标对齐）：
 * - 仅在“启动后”执行一次（不做常驻定时器），避免引入运行期资源消耗与并发竞态；
 * - 由启动维护编排器统一调度（见 `electron-main/services/startup/startupMaintenanceRunner.ts`）；
 * - 维护与 HTTP、CLI 握手共用 App Server 的事件循环：只读取挂有卫星数据的文档，
 *   并在每篇之后让出一轮事件循环，不能整段占住。
 */

import type { DatabaseService } from '../database';
import Database from 'better-sqlite3';
import { MarkdownOrphanBlockDataCleaner } from 'src/domains/markdown';
import { Logger } from '../../../shared/logger';

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * 执行一次 Workspace 维护任务（目前仅：清理 Markdown 幽灵块数据）。
 *
 * 注意：
 * - 此函数应在 DatabaseService 初始化完成后调用；
 * - 只做 SQLite 内部清理，不触碰知识库三源（Qdrant/SoT/KB 元数据）；
 * - 保存正文时 `updateDocument` 已在同一事务内清理幽灵数据，这里只复查遗留的卫星行。
 */
export async function runWorkspaceMaintenanceOnce(databaseService: DatabaseService): Promise<void> {
  const logger = new Logger('WorkspaceMaintenance');
  try {
    const db: Database.Database = databaseService.getDb();
    const startedAt = Date.now();

    // 构造所需的服务实例（轻量级）
    const markdownService = createMarkdownDocumentStore(db);
    const cleaner = new MarkdownOrphanBlockDataCleaner(db, markdownService);

    logger.info('🧹 启动维护：开始执行幽灵块数据清理任务...');

    // 1) 没有 pending / 块历史的文档不可能有幽灵数据：只取挂有卫星数据的文档，
    //    不扫描全部文档节点，维护成本只随卫星数据增长。
    const candidates = cleaner.listDocumentsWithBlockSatelliteData();
    const stmtLiveDocument = db.prepare<[string], { found: number }>(`
      SELECT 1 AS found
      FROM workspace_nodes
      WHERE id = ? AND type = 'document' AND deleted_at IS NULL
    `);

    let checkedDocs = 0;
    let cleanedDocs = 0;
    let failedDocs = 0;
    let totalRemovedPending = 0;
    let totalRemovedBlockVersions = 0;
    let maxDocumentCostMs = 0;

    // 2) 逐文档清理（只在有删除或失败时记录单条日志，避免日志膨胀）
    for (const documentId of candidates) {
      // 只处理有效的文档节点；处理前再确认一次，维护期间被删除的文档直接跳过。
      if (!stmtLiveDocument.get(documentId)) continue;
      checkedDocs += 1;
      const documentStartedAt = Date.now();
      try {
        const result = cleaner.cleanupDocumentOrphans(documentId);
        totalRemovedPending += result.removedPending;
        totalRemovedBlockVersions += result.removedBlockVersions;

        if (
          result.removedPending > 0 ||
          result.removedBlockVersions > 0
        ) {
          cleanedDocs += 1;
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
      maxDocumentCostMs = Math.max(maxDocumentCostMs, Date.now() - documentStartedAt);
      // 单篇清理是同步 SQLite 调用；每篇之后让出一轮事件循环，排队的 I/O 才能被处理。
      await yieldToEventLoop();
    }

    // 3) 汇总日志（关键：始终仅输出一条 summary）
    logger.info(
      `✅ 启动维护：幽灵块清理完成. checked=${checkedDocs}, ` +
        `cleaned=${cleanedDocs}, failed=${failedDocs}, ` +
        `removed(pending=${totalRemovedPending}, blockVersions=${totalRemovedBlockVersions}), ` +
        `costMs=${Date.now() - startedAt}, maxDocumentCostMs=${maxDocumentCostMs}`
    );
  } catch (error) {
    logger.error(
      `❌ 启动维护：幽灵块数据清理任务执行失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
