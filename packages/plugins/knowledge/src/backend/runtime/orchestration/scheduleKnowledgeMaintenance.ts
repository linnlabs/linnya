import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from '@plugin/backend/loggingRuntime';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { QdrantRepository } from '../../infrastructure/qdrantRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import type { KnowledgeActivityOwner } from './createKnowledgeActivityOwner';
import { runKnowledgeBaseStartupMaintenanceOnce } from '../../ingestion/failureCleanup';
import { runChunkCollectionStartupMaintenanceOnce } from '../../infrastructure/qdrant-repository/startupChunkCollectionMaintenance';
interface KnowledgeBaseMaintenanceDeps {
  metadataRepository: MetadataRepository; qdrantRepository: QdrantRepository;
  sotRepository: SotRepository; originalDocumentRepository: OriginalDocumentRepository;
  knowledgeGraphRepository: KnowledgeGraphRepository; activity: KnowledgeActivityOwner;
}
/** 界面首次实际向量访问后调度一次，普通启动、原文读取与项目 CLI 不触发全库维护。 */
export function scheduleKnowledgeMaintenance(deps: KnowledgeBaseMaintenanceDeps) {
  const controller = new AbortController();
  const completion = delay(10_000, undefined, { signal: controller.signal })
    .then(() => runKnowledgeBaseMaintenance(deps, controller.signal))
    .catch(error => { if (!controller.signal.aborted) new Logger('KnowledgeMaintenance').error('维护失败', error); });
  return { stop: () => { controller.abort(); return completion; } };
}
async function waitForQdrantReachable(params: {
  qdrantRepository: QdrantRepository;
  logger: Logger;
  maxWaitMs: number;
  pollIntervalMs: number;
  signal: AbortSignal;
}): Promise<boolean> {
  const { qdrantRepository, logger, maxWaitMs, pollIntervalMs, signal } = params;
  const start = Date.now();
  while (!signal.aborted && Date.now() - start < maxWaitMs) {
    try {
      await qdrantRepository.collectionExists('default');
      return true;
    } catch (e) {
      logger.warn(
        `Qdrant 未就绪，等待重试中... costMs=${Date.now() - start}, err=${e instanceof Error ? e.message : String(e)}`
      );
      await delay(pollIntervalMs, undefined, { signal });
    }
  }
  return false;
}

async function runKnowledgeBaseMaintenance(
  knowledgeBase: KnowledgeBaseMaintenanceDeps,
  signal: AbortSignal,
): Promise<void> {
  const logger = new Logger('KnowledgeBaseMaintenance');
    try {
      /**
       * 根因修复（稳健性）：
       * - 在执行知识库三源一致性维护前，必须确保 Qdrant “可达”
       * - 否则不可达会被误判为缺失，从而触发破坏性清理
       *
       * 这里等待一段时间（最多 2 分钟），仍不可达则跳过本轮知识库维护（不做破坏性动作）
       */
      const qdrantReachable = await waitForQdrantReachable({
        qdrantRepository: knowledgeBase.qdrantRepository,
        logger,
        maxWaitMs: 120_000,
        pollIntervalMs: 5_000,
        signal,
      });
      if (signal.aborted) return;
      if (!qdrantReachable) {
        logger.warn(
          'Qdrant 在启动维护窗口内仍不可达，跳过本轮知识库维护（避免误删），后续可由用户/后台触发再次维护'
        );
        return;
      }

      const stats = await runKnowledgeBaseStartupMaintenanceOnce(
        knowledgeBase.metadataRepository,
        knowledgeBase.qdrantRepository,
        knowledgeBase.sotRepository,
        knowledgeBase.knowledgeGraphRepository,
        knowledgeBase.originalDocumentRepository,
        knowledgeBase.activity
      );
      logger.info(
        `知识库维护汇总: totalFailed=${stats.totalFailed}, sqliteCleared=${stats.sqliteCleared}, qdrantCleared=${stats.qdrantCleared}, sotCleared=${stats.sotCleared}`
      );

      if (signal.aborted) return;
      const chunkStats = await runChunkCollectionStartupMaintenanceOnce(
        knowledgeBase.metadataRepository,
        knowledgeBase.qdrantRepository,
        knowledgeBase.activity
      );
      logger.info(
        `chunk collection 启动维护汇总: scanned=${chunkStats.scannedCollections}, recreated=${chunkStats.recreatedCollections}, deletedEmpty=${chunkStats.deletedEmptyCollections}, skipped=${chunkStats.skippedCollections}, failed=${chunkStats.failedCollections}`
      );
    } catch (e) {
      if (signal.aborted) return;
      logger.error(`知识库维护执行失败: ${e instanceof Error ? e.message : String(e)}`);
    }


}
